const ChannelDataMapper = require('../models/channelDataMapper');
const ChannelConfigService = require('./channelConfigService');

/**
 * 频道克隆核心服务
 * 负责实际的消息克隆操作，包括实时克隆和编辑同步
 */
class ChannelCloneService {
    constructor(bot) {
        this.bot = bot;
        this.dataMapper = new ChannelDataMapper();
        this.configService = new ChannelConfigService();
        
        // 实例标识，用于调试
        this.instanceId = Math.random().toString(36).substring(2, 8);
        console.log(`📺 频道克隆服务实例创建: ${this.instanceId}`);
        
        // 速率限制管理器
        this.rateLimiters = new Map(); // configId -> { tokens, lastRefill }
        
        // 媒体组收集器
        this.mediaGroups = new Map(); // media_group_id -> { messages: [], timer: timeout, config: config }
        this.mediaGroupTimeout = 5000; // 增加到5秒超时，收集完整媒体组
        
        // 延时处理队列
        this.delayedTasks = new Map(); // configId -> { queue: [], processing: boolean }
        this.sequentialQueues = new Map(); // configId -> { queue: [], processing: boolean }
        
        // 消息处理去重器 - 使用全局存储
        if (!global.channelCloneProcessedMessages) {
            global.channelCloneProcessedMessages = new Set();
        }
        this.processedMessages = global.channelCloneProcessedMessages;
        this.messageCleanupInterval = 300000; // 5分钟清理一次已处理消息记录
        
        // 媒体组去重器 - 防止重复处理同一个媒体组
        this.processedMediaGroups = new Set();
        
        // 克隆状态追踪
        this.cloneStats = {
            totalCloned: 0,
            totalErrors: 0,
            lastCloneTime: null
        };
        
        // 初始化消息监听器
        this.initializeMessageListeners();
        
        // 启动消息去重清理定时器
        this.startMessageCleanup();
    }

    /**
     * 初始化消息监听器
     */
    initializeMessageListeners() {
        if (!this.bot) {
            console.error('❌ Bot未初始化，无法设置消息监听器');
            return;
        }

        // 检查是否已有其他实例的监听器，如果有则先清理
        if (global.channelCloneListenerActive && global.channelCloneListenerActive !== this.instanceId) {
            console.warn(`⚠️ [${this.instanceId}] 检测到其他活跃的频道克隆监听器: ${global.channelCloneListenerActive}，正在清理...`);
            // 清理旧的监听器
            this.bot.removeAllListeners('channel_post');
            this.bot.removeAllListeners('edited_channel_post');
            console.log(`🧹 [${this.instanceId}] 已清理旧的频道监听器`);
        }
        
        // 标记监听器为活跃状态
        global.channelCloneListenerActive = this.instanceId;

        // 监听新消息（群组、私聊等，排除频道）
        this.bot.on('message', (msg) => {
            // 跳过频道消息，由channel_post处理
            if (msg.chat.type === 'channel') {
                return;
            }
            this.handleNewMessage(msg);
        });

        // 监听消息编辑（群组、私聊等，排除频道）
        this.bot.on('edited_message', (msg) => {
            // 跳过频道消息，由edited_channel_post处理
            if (msg.chat.type === 'channel') {
                return;
            }
            this.handleEditedMessage(msg);
        });

        // 🔥 关键修复：监听频道消息
        this.bot.on('channel_post', (msg) => {
            console.log(`📺 [${this.instanceId}] 收到频道消息: ${msg.chat.id} - ${msg.message_id}`);
            this.handleNewMessage(msg);
        });

        // 🔥 关键修复：监听频道编辑消息
        this.bot.on('edited_channel_post', (msg) => {
            console.log(`📺 [${this.instanceId}] 收到频道编辑消息: ${msg.chat.id} - ${msg.message_id}`);
            this.handleEditedMessage(msg);
        });

        console.log(`📺 [${this.instanceId}] 频道克隆消息监听器已初始化（包含频道消息监听）`);
    }

    /**
     * 启动消息去重清理定时器
     */
    startMessageCleanup() {
        this.cleanupTimer = setInterval(() => {
            const currentMessageSize = this.processedMessages.size;
            const currentMediaGroupSize = this.processedMediaGroups.size;
            
            // 清理已处理消息记录（当超过10000条时清理）
            if (currentMessageSize > 10000) {
                this.processedMessages.clear();
                console.log(`🧹 清理消息去重记录: ${currentMessageSize} -> 0`);
            }
            
            // 清理媒体组去重记录（当超过1000条时清理）
            if (currentMediaGroupSize > 1000) {
                this.processedMediaGroups.clear();
                console.log(`🧹 清理媒体组去重记录: ${currentMediaGroupSize} -> 0`);
            }
        }, this.messageCleanupInterval);
    }

    /**
     * 处理新消息
     */
    async handleNewMessage(message) {
        try {
            const chatId = message.chat.id.toString();
            const messageKey = `${chatId}_${message.message_id}`;
            
            // 检查消息是否已经处理过
            if (this.processedMessages.has(messageKey)) {
                console.log(`📺 [${this.instanceId}] 跳过重复消息: ${chatId} - ${message.message_id}`);
                return;
            }
            
            // 标记消息为已处理
            this.processedMessages.add(messageKey);
            console.log(`📺 [${this.instanceId}] 开始处理消息: ${chatId} - ${message.message_id}`);
            
            // 查找对应的配置
            const config = await this.configService.getConfigBySourceChannel(chatId);
            if (!config || !config.settings.enabled) {
                return; // 没有配置或配置已禁用
            }

            console.log(`📺 收到源频道 ${chatId} 的新消息 ${message.message_id}`);

            // 检查是否为媒体组消息
            if (message.media_group_id) {
                console.log(`📺 检测到媒体组消息: ${message.media_group_id}`);
                await this.handleMediaGroupMessage(config, message);
                return;
            }

            // 检查速率限制
            const rateLimitCheck = await this.checkRateLimit(config);
            if (!rateLimitCheck.allowed) {
                console.log(`📺 速率限制：跳过消息 ${message.message_id}`);
                await this.dataMapper.logAction(
                    config.id,
                    'clone_rate_limited',
                    'warning',
                    '超过速率限制',
                    0,
                    { message_id: message.message_id, source_channel: chatId }
                );
                return;
            }

            // 检查是否需要延时或顺序处理
            const delaySeconds = config.settings.delaySeconds || 0;
            const sequentialMode = config.settings.sequentialMode || false;

            if (delaySeconds > 0 || sequentialMode) {
                // 添加到延时/顺序队列
                await this.addToProcessingQueue(config, message, delaySeconds, sequentialMode);
                return;
            }

            // 立即执行单条消息克隆
            const cloneResult = await this.cloneMessage(config, message);
            
            if (cloneResult.success) {
                // 创建消息映射
                await this.dataMapper.createMessageMapping(
                    config.id,
                    message.message_id,
                    cloneResult.targetMessageId,
                    this.getMessageType(message)
                );

                this.cloneStats.totalCloned++;
                this.cloneStats.lastCloneTime = new Date();

                console.log(`✅ 消息克隆成功: ${message.message_id} -> ${cloneResult.targetMessageId}`);
                
                // 记录成功日志
                await this.dataMapper.logAction(
                    config.id,
                    'message_clone',
                    'success',
                    null,
                    cloneResult.processingTime,
                    {
                        source_message_id: message.message_id,
                        target_message_id: cloneResult.targetMessageId,
                        message_type: this.getMessageType(message)
                    }
                );
            } else {
                this.cloneStats.totalErrors++;
                console.error(`❌ 消息克隆失败: ${cloneResult.error}`);
                
                // 记录错误日志
                await this.dataMapper.logAction(
                    config.id,
                    'message_clone',
                    'error',
                    cloneResult.error,
                    cloneResult.processingTime || 0,
                    {
                        source_message_id: message.message_id,
                        message_type: this.getMessageType(message)
                    }
                );
            }
        } catch (error) {
            console.error('处理新消息失败:', error);
        }
    }

    /**
     * 处理编辑的消息
     */
    async handleEditedMessage(message) {
        try {
            const chatId = message.chat.id.toString();
            
            // 查找对应的配置
            const config = await this.configService.getConfigBySourceChannel(chatId);
            if (!config || !config.settings.enabled || !config.settings.syncEdits) {
                return; // 没有配置、配置已禁用或未启用编辑同步
            }

            console.log(`📺 收到源频道 ${chatId} 的消息编辑 ${message.message_id}`);

            // 检查是否为媒体组消息的编辑
            if (message.media_group_id) {
                console.log(`📺 检测到媒体组编辑消息: ${message.media_group_id}`);
                // 媒体组的编辑比较复杂，暂时记录日志
                await this.dataMapper.logAction(
                    config.id,
                    'media_group_edit',
                    'info',
                    '媒体组编辑暂不支持自动同步',
                    0,
                    {
                        source_message_id: message.message_id,
                        media_group_id: message.media_group_id
                    }
                );
                return;
            }

            // 查找消息映射
            const mapping = await this.dataMapper.getMessageMapping(message.message_id, config.id);
            if (!mapping) {
                console.log(`📺 未找到消息映射: ${message.message_id}`);
                return;
            }

            // 执行编辑同步
            const editResult = await this.syncMessageEdit(config, message, mapping.targetMessageId);
            
            if (editResult.success) {
                console.log(`✅ 消息编辑同步成功: ${message.message_id} -> ${mapping.targetMessageId}`);
                
                // 记录成功日志
                await this.dataMapper.logAction(
                    config.id,
                    'message_edit_sync',
                    'success',
                    null,
                    editResult.processingTime,
                    {
                        source_message_id: message.message_id,
                        target_message_id: mapping.targetMessageId,
                        edit_time: message.edit_date
                    }
                );
            } else {
                console.error(`❌ 消息编辑同步失败: ${editResult.error}`);
                
                // 记录错误日志
                await this.dataMapper.logAction(
                    config.id,
                    'message_edit_sync',
                    'error',
                    editResult.error,
                    editResult.processingTime || 0,
                    {
                        source_message_id: message.message_id,
                        target_message_id: mapping.targetMessageId
                    }
                );
            }
        } catch (error) {
            console.error('处理编辑消息失败:', error);
        }
    }

    /**
     * 处理媒体组消息
     */
    async handleMediaGroupMessage(config, message) {
        const mediaGroupId = message.media_group_id;
        
        // 检查是否已经处理过这个媒体组
        if (this.processedMediaGroups.has(mediaGroupId)) {
            console.log(`📺 媒体组 ${mediaGroupId} 已经处理过，跳过消息 ${message.message_id}`);
            return;
        }

        // 检查速率限制
        const rateLimitCheck = await this.checkRateLimit(config);
        if (!rateLimitCheck.allowed) {
            console.log(`📺 媒体组速率限制：跳过消息 ${message.message_id}`);
            return;
        }

        // 获取或创建媒体组收集器
        if (!this.mediaGroups.has(mediaGroupId)) {
            this.mediaGroups.set(mediaGroupId, {
                messages: [],
                config: config,
                timer: null,
                createdAt: Date.now()
            });
        }

        const mediaGroup = this.mediaGroups.get(mediaGroupId);
        
        // 检查消息是否已经在组中（防止重复添加）
        const messageExists = mediaGroup.messages.some(msg => msg.message_id === message.message_id);
        if (messageExists) {
            console.log(`📺 媒体组 ${mediaGroupId} 中消息 ${message.message_id} 已存在，跳过`);
            return;
        }
        
        mediaGroup.messages.push(message);

        console.log(`📺 媒体组 ${mediaGroupId} 收集到 ${mediaGroup.messages.length} 条消息`);

        // 清除之前的定时器
        if (mediaGroup.timer) {
            clearTimeout(mediaGroup.timer);
        }

        // 设置新的定时器，等待更多消息或超时处理
        mediaGroup.timer = setTimeout(async () => {
            // 检查是否需要延时或顺序处理
            const delaySeconds = config.settings.delaySeconds || 0;
            const sequentialMode = config.settings.sequentialMode || false;

            if (delaySeconds > 0 || sequentialMode) {
                console.log(`📺 媒体组 ${mediaGroupId} 将使用延时/顺序处理模式`);
                // 添加到延时/顺序队列
                await this.addMediaGroupToProcessingQueue(mediaGroupId, delaySeconds, sequentialMode);
            } else {
                // 立即处理媒体组
                await this.processMediaGroup(mediaGroupId);
            }
        }, this.mediaGroupTimeout);
    }

    /**
     * 处理完整的媒体组
     */
    async processMediaGroup(mediaGroupId) {
        const mediaGroup = this.mediaGroups.get(mediaGroupId);
        if (!mediaGroup) {
            return;
        }

        try {
            console.log(`📺 开始处理媒体组 ${mediaGroupId}，包含 ${mediaGroup.messages.length} 条消息`);
            
            const startTime = Date.now();
            const config = mediaGroup.config;
            const messages = mediaGroup.messages.sort((a, b) => a.message_id - b.message_id); // 按消息ID排序
            
            // 构建媒体组数据
            const mediaItems = [];
            let groupCaption = null;
            let captionMessage = null;

            for (const msg of messages) {
                const mediaItem = await this.buildMediaItem(msg);
                if (mediaItem) {
                    mediaItems.push(mediaItem);
                    
                    // 使用第一个有标题的消息作为组标题
                    if (!groupCaption && (msg.caption || msg.text)) {
                        groupCaption = msg.caption || msg.text;
                        captionMessage = msg;
                    }
                }
            }

            if (mediaItems.length === 0) {
                throw new Error('媒体组中没有有效的媒体项');
            }

            // 设置组标题到第一个媒体项
            if (groupCaption && mediaItems.length > 0) {
                mediaItems[0].caption = groupCaption;
                if (captionMessage && captionMessage.caption_entities) {
                    mediaItems[0].caption_entities = captionMessage.caption_entities;
                }
            }

            console.log(`📺 发送媒体组到目标频道，包含 ${mediaItems.length} 个媒体项`);

            // 发送媒体组
            const result = await this.bot.sendMediaGroup(config.targetChannel.id, mediaItems);
            
            const processingTime = Date.now() - startTime;

            if (result && result.length > 0) {
                console.log(`✅ 媒体组克隆成功: ${mediaGroupId} -> ${result.length} 条消息`);
                
                // 标记媒体组为已处理
                this.processedMediaGroups.add(mediaGroupId);
                
                // 创建消息映射
                for (let i = 0; i < Math.min(messages.length, result.length); i++) {
                    await this.dataMapper.createMessageMapping(
                        config.id,
                        messages[i].message_id,
                        result[i].message_id,
                        this.getMessageType(messages[i])
                    );
                }

                this.cloneStats.totalCloned += result.length;
                this.cloneStats.lastCloneTime = new Date();

                // 记录成功日志
                await this.dataMapper.logAction(
                    config.id,
                    'media_group_clone',
                    'success',
                    null,
                    processingTime,
                    {
                        media_group_id: mediaGroupId,
                        source_messages: messages.length,
                        target_messages: result.length,
                        media_types: mediaItems.map(item => item.type).join(',')
                    }
                );
            } else {
                throw new Error('发送媒体组返回空结果');
            }

        } catch (error) {
            this.cloneStats.totalErrors++;
            console.error(`❌ 媒体组克隆失败: ${error.message}`);
            
            // 即使失败也标记为已处理，防止无限重试
            this.processedMediaGroups.add(mediaGroupId);
            
            // 记录错误日志
            await this.dataMapper.logAction(
                config.id,
                'media_group_clone',
                'error',
                error.message,
                0,
                {
                    media_group_id: mediaGroupId,
                    message_count: mediaGroup.messages.length
                }
            );
        } finally {
            // 清理媒体组数据
            this.mediaGroups.delete(mediaGroupId);
        }
    }

    /**
     * 构建媒体项用于sendMediaGroup
     */
    async buildMediaItem(message) {
        try {
            if (message.photo && message.photo.length > 0) {
                // 图片
                const photo = message.photo[message.photo.length - 1]; // 最大尺寸
                return {
                    type: 'photo',
                    media: photo.file_id
                };
            } else if (message.video) {
                // 视频
                return {
                    type: 'video',
                    media: message.video.file_id,
                    width: message.video.width,
                    height: message.video.height,
                    duration: message.video.duration
                };
            } else if (message.document) {
                // 文档
                return {
                    type: 'document',
                    media: message.document.file_id
                };
            } else if (message.audio) {
                // 音频
                return {
                    type: 'audio',
                    media: message.audio.file_id,
                    duration: message.audio.duration,
                    performer: message.audio.performer,
                    title: message.audio.title
                };
            }
            
            return null;
        } catch (error) {
            console.error('构建媒体项失败:', error);
            return null;
        }
    }

    /**
     * 克隆单个消息
     */
    async cloneMessage(config, message) {
        const startTime = Date.now();
        
        try {
            let clonedMessage;
            const targetChannelId = config.targetChannel.id;

            // 根据消息类型进行克隆
            if (message.photo && message.photo.length > 0) {
                // 图片消息
                const photo = message.photo[message.photo.length - 1]; // 获取最大尺寸的图片
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.video) {
                // 视频消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.document) {
                // 文档消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.audio) {
                // 音频消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.voice) {
                // 语音消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.sticker) {
                // 贴纸消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.animation) {
                // GIF动画
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.video_note) {
                // 视频备注
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else if (message.location) {
                // 位置消息
                clonedMessage = await this.bot.sendLocation(
                    targetChannelId,
                    message.location.latitude,
                    message.location.longitude
                );
            } else if (message.contact) {
                // 联系人消息
                clonedMessage = await this.bot.sendContact(
                    targetChannelId,
                    message.contact.phone_number,
                    message.contact.first_name,
                    {
                        last_name: message.contact.last_name,
                        vcard: message.contact.vcard
                    }
                );
            } else if (message.poll) {
                // 投票消息
                const pollOptions = message.poll.options.map(option => option.text);
                clonedMessage = await this.bot.sendPoll(
                    targetChannelId,
                    message.poll.question,
                    pollOptions,
                    {
                        is_anonymous: message.poll.is_anonymous,
                        type: message.poll.type,
                        allows_multiple_answers: message.poll.allows_multiple_answers
                    }
                );
            } else if (message.text) {
                // 纯文本消息
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            } else {
                // 其他类型消息，尝试使用copyMessage
                clonedMessage = await this.bot.copyMessage(
                    targetChannelId,
                    message.chat.id,
                    message.message_id
                );
            }

            const processingTime = Date.now() - startTime;

            return {
                success: true,
                targetMessageId: clonedMessage.message_id,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            console.error('克隆消息失败:', error);
            return {
                success: false,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * 同步消息编辑
     */
    async syncMessageEdit(config, editedMessage, targetMessageId) {
        const startTime = Date.now();
        
        try {
            const targetChannelId = config.targetChannel.id;

            // 根据消息类型进行编辑同步
            if (editedMessage.text) {
                // 文本消息编辑
                await this.bot.editMessageText(
                    editedMessage.text,
                    {
                        chat_id: targetChannelId,
                        message_id: targetMessageId,
                        parse_mode: editedMessage.entities ? 'HTML' : undefined,
                        disable_web_page_preview: true
                    }
                );
            } else if (editedMessage.caption !== undefined) {
                // 媒体消息标题编辑
                await this.bot.editMessageCaption(
                    editedMessage.caption || '',
                    {
                        chat_id: targetChannelId,
                        message_id: targetMessageId,
                        parse_mode: editedMessage.caption_entities ? 'HTML' : undefined
                    }
                );
            } else {
                // 其他类型的编辑，暂不支持
                throw new Error('不支持的消息编辑类型');
            }

            const processingTime = Date.now() - startTime;

            return {
                success: true,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            console.error('同步消息编辑失败:', error);
            return {
                success: false,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * 检查速率限制
     */
    async checkRateLimit(config) {
        const configId = config.id;
        const rateLimit = config.settings.rateLimit || 30; // 默认每分钟30条
        const now = Date.now();

        if (!this.rateLimiters.has(configId)) {
            this.rateLimiters.set(configId, {
                tokens: rateLimit,
                lastRefill: now
            });
        }

        const limiter = this.rateLimiters.get(configId);
        
        // 计算需要补充的令牌数
        const timePassed = now - limiter.lastRefill;
        const tokensToAdd = Math.floor(timePassed / (60 * 1000)) * rateLimit; // 每分钟补充rateLimit个令牌
        
        if (tokensToAdd > 0) {
            limiter.tokens = Math.min(rateLimit, limiter.tokens + tokensToAdd);
            limiter.lastRefill = now;
        }

        // 检查是否有可用令牌
        if (limiter.tokens > 0) {
            limiter.tokens--;
            return { allowed: true, remainingTokens: limiter.tokens };
        } else {
            return { allowed: false, remainingTokens: 0 };
        }
    }

    /**
     * 获取消息类型
     */
    getMessageType(message) {
        if (message.photo) return 'photo';
        if (message.video) return 'video';
        if (message.document) return 'document';
        if (message.audio) return 'audio';
        if (message.voice) return 'voice';
        if (message.sticker) return 'sticker';
        if (message.animation) return 'animation';
        if (message.video_note) return 'video_note';
        if (message.location) return 'location';
        if (message.contact) return 'contact';
        if (message.poll) return 'poll';
        if (message.text) return 'text';
        return 'unknown';
    }

    /**
     * 批量历史消息同步
     */
    async syncHistoryMessages(configName, options = {}) {
        try {
            const {
                limit = 100,
                offsetDate = null,
                progressCallback = null
            } = options;

            const config = await this.configService.getConfig(configName);
            if (!config) {
                throw new Error('配置不存在');
            }

            console.log(`📺 开始同步历史消息: ${configName}, 限制: ${limit}`);

            const results = {
                total: 0,
                success: 0,
                failed: 0,
                errors: []
            };

            // 获取源频道的历史消息
            // 注意：这需要Bot有读取消息历史的权限
            const messages = await this.getChannelHistory(config.sourceChannel.id, limit, offsetDate);
            results.total = messages.length;

            for (let i = 0; i < messages.length; i++) {
                const message = messages[i];
                
                try {
                    // 检查是否已经克隆过
                    const existingMapping = await this.dataMapper.getMessageMapping(message.message_id, config.id);
                    if (existingMapping) {
                        console.log(`📺 消息 ${message.message_id} 已克隆过，跳过`);
                        continue;
                    }

                    // 检查速率限制
                    const rateLimitCheck = await this.checkRateLimit(config);
                    if (!rateLimitCheck.allowed) {
                        console.log(`📺 速率限制：等待60秒后继续`);
                        await this.sleep(60000); // 等待1分钟
                        continue;
                    }

                    // 克隆消息
                    const cloneResult = await this.cloneMessage(config, message);
                    
                    if (cloneResult.success) {
                        // 创建消息映射
                        await this.dataMapper.createMessageMapping(
                            config.id,
                            message.message_id,
                            cloneResult.targetMessageId,
                            this.getMessageType(message)
                        );

                        results.success++;
                        console.log(`✅ 历史消息克隆成功: ${message.message_id} -> ${cloneResult.targetMessageId}`);
                    } else {
                        results.failed++;
                        results.errors.push({
                            messageId: message.message_id,
                            error: cloneResult.error
                        });
                        console.error(`❌ 历史消息克隆失败: ${cloneResult.error}`);
                    }

                    // 调用进度回调
                    if (progressCallback) {
                        progressCallback({
                            current: i + 1,
                            total: messages.length,
                            success: results.success,
                            failed: results.failed
                        });
                    }

                    // 添加延迟避免API限制
                    await this.sleep(1000); // 1秒延迟

                } catch (error) {
                    results.failed++;
                    results.errors.push({
                        messageId: message.message_id,
                        error: error.message
                    });
                    console.error(`❌ 处理历史消息失败: ${error.message}`);
                }
            }

            // 记录同步结果
            await this.dataMapper.logAction(
                config.id,
                'history_sync',
                results.failed === 0 ? 'success' : 'partial',
                results.failed > 0 ? `${results.failed} 条消息同步失败` : null,
                0,
                results
            );

            console.log(`📺 历史消息同步完成: 成功 ${results.success}/${results.total}`);
            return results;

        } catch (error) {
            console.error('同步历史消息失败:', error);
            throw error;
        }
    }

    /**
     * 获取频道历史消息
     */
    async getChannelHistory(channelId, limit = 100, offsetDate = null) {
        try {
            // 注意：这个方法需要Bot API支持获取频道历史
            // 如果Bot API不支持，可能需要使用其他方法
            const messages = [];
            
            // 这里简化实现，实际可能需要更复杂的逻辑
            // 由于Bot API限制，可能无法直接获取历史消息
            // 需要使用其他方法或者依赖消息转发
            
            console.log(`📺 获取频道 ${channelId} 的历史消息功能需要进一步实现`);
            return messages;
            
        } catch (error) {
            console.error('获取频道历史消息失败:', error);
            return [];
        }
    }

    /**
     * 获取克隆统计信息
     */
    getCloneStats() {
        return {
            ...this.cloneStats,
            activeConfigs: this.rateLimiters.size,
            rateLimiters: Array.from(this.rateLimiters.entries()).map(([configId, limiter]) => ({
                configId,
                remainingTokens: limiter.tokens,
                lastRefill: new Date(limiter.lastRefill)
            }))
        };
    }

    /**
     * 重置克隆统计
     */
    resetCloneStats() {
        this.cloneStats = {
            totalCloned: 0,
            totalErrors: 0,
            lastCloneTime: null
        };
        console.log('📺 克隆统计已重置');
    }

    /**
     * 重新加载配置
     */
    async reloadConfigs() {
        try {
            // 清除配置缓存
            this.configService.clearConfigCache();
            
            // 重置速率限制器
            this.rateLimiters.clear();
            
            console.log('📺 频道配置已重新加载');
            
            return { success: true };
        } catch (error) {
            console.error('重新加载配置失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止克隆服务
     */
    stop() {
        try {
            if (this.bot) {
                this.bot.removeAllListeners('message');
                this.bot.removeAllListeners('edited_message');
                this.bot.removeAllListeners('channel_post');
                this.bot.removeAllListeners('edited_channel_post');
            }
            
            // 清理所有媒体组定时器
            for (const [groupId, group] of this.mediaGroups.entries()) {
                if (group.timer) {
                    clearTimeout(group.timer);
                }
            }
            this.mediaGroups.clear();
            
            // 清理消息去重定时器
            if (this.cleanupTimer) {
                clearInterval(this.cleanupTimer);
            }
            
            // 清理全局标记
            if (global.channelCloneListenerActive === this.instanceId) {
                global.channelCloneListenerActive = null;
            }
            
            this.rateLimiters.clear();
            
            console.log(`📺 [${this.instanceId}] 频道克隆服务已停止`);
            return { success: true };
        } catch (error) {
            console.error('停止克隆服务失败:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 工具方法：延迟
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 添加消息到处理队列（支持延时和顺序处理）
     */
    async addToProcessingQueue(config, message, delaySeconds, sequentialMode) {
        const configId = config.id;
        const executeTime = Date.now() + (delaySeconds * 1000);
        
        const task = {
            id: `${configId}_${message.message_id}_${Date.now()}`,
            configId,
            config,
            message,
            executeTime,
            attempts: 0,
            maxAttempts: 3
        };

        if (sequentialMode) {
            // 顺序处理模式
            if (!this.sequentialQueues.has(configId)) {
                this.sequentialQueues.set(configId, {
                    queue: [],
                    processing: false
                });
            }
            
            const queueInfo = this.sequentialQueues.get(configId);
            queueInfo.queue.push(task);
            
            console.log(`📺 [顺序模式] 消息 ${message.message_id} 已添加到队列，队列长度: ${queueInfo.queue.length}`);
            
            // 如果当前没有在处理，立即开始处理
            if (!queueInfo.processing) {
                this.processSequentialQueue(configId);
            }
        } else {
            // 延时处理模式
            console.log(`📺 [延时模式] 消息 ${message.message_id} 将在 ${delaySeconds} 秒后处理`);
            
            setTimeout(async () => {
                await this.processDelayedTask(task);
            }, delaySeconds * 1000);
        }

        // 记录日志
        await this.dataMapper.logAction(
            config.id,
            sequentialMode ? 'message_queued_sequential' : 'message_queued_delayed',
            'info',
            null,
            0,
            {
                message_id: message.message_id,
                delay_seconds: delaySeconds,
                sequential_mode: sequentialMode,
                queue_length: sequentialMode ? this.sequentialQueues.get(configId)?.queue.length : 1
            }
        );
    }

    /**
     * 处理顺序队列
     */
    async processSequentialQueue(configId) {
        const queueInfo = this.sequentialQueues.get(configId);
        if (!queueInfo || queueInfo.processing) {
            return;
        }

        queueInfo.processing = true;
        console.log(`📺 [顺序模式] 开始处理配置 ${configId} 的队列，队列长度: ${queueInfo.queue.length}`);

        while (queueInfo.queue.length > 0) {
            const task = queueInfo.queue.shift();
            
            try {
                // 检查是否需要等待延时时间
                const now = Date.now();
                if (task.executeTime > now) {
                    const waitTime = task.executeTime - now;
                    console.log(`📺 [顺序模式] 等待 ${Math.round(waitTime/1000)} 秒后处理消息 ${task.message.message_id}`);
                    await this.sleep(waitTime);
                }

                if (task.isMediaGroup) {
                    // 处理媒体组任务
                    console.log(`📺 [顺序模式] 处理媒体组 ${task.mediaGroupId}，剩余队列: ${queueInfo.queue.length}`);
                    
                    try {
                        await this.processMediaGroup(task.mediaGroupId);
                        console.log(`✅ [顺序模式] 媒体组处理成功: ${task.mediaGroupId}`);
                    } catch (error) {
                        console.error(`❌ [顺序模式] 媒体组处理失败: ${task.mediaGroupId}`, error);
                        
                        // 媒体组处理失败，可以选择重试
                        task.attempts++;
                        if (task.attempts < task.maxAttempts) {
                            queueInfo.queue.push(task);
                            console.log(`❌ [顺序模式] 媒体组 ${task.mediaGroupId} 处理失败，重试 ${task.attempts}/${task.maxAttempts}`);
                        }
                    }
                } else {
                    // 处理普通消息任务
                    console.log(`📺 [顺序模式] 处理消息 ${task.message.message_id}，剩余队列: ${queueInfo.queue.length}`);
                    
                    // 执行克隆
                    const cloneResult = await this.cloneMessage(task.config, task.message);
                    
                    if (cloneResult.success) {
                        // 创建消息映射
                        await this.dataMapper.createMessageMapping(
                            task.config.id,
                            task.message.message_id,
                            cloneResult.targetMessageId,
                            this.getMessageType(task.message)
                        );

                        this.cloneStats.totalCloned++;
                        this.cloneStats.lastCloneTime = new Date();

                        console.log(`✅ [顺序模式] 消息克隆成功: ${task.message.message_id} -> ${cloneResult.targetMessageId}`);
                        
                        // 记录成功日志
                        await this.dataMapper.logAction(
                            task.config.id,
                            'sequential_clone_success',
                            'success',
                            null,
                            cloneResult.processingTime,
                            {
                                source_message_id: task.message.message_id,
                                target_message_id: cloneResult.targetMessageId,
                                message_type: this.getMessageType(task.message),
                                queue_position: queueInfo.queue.length + 1
                            }
                        );
                    } else {
                        // 处理失败
                        task.attempts++;
                        if (task.attempts < task.maxAttempts) {
                            // 重新加入队列末尾
                            queueInfo.queue.push(task);
                            console.log(`❌ [顺序模式] 消息 ${task.message.message_id} 处理失败，重试 ${task.attempts}/${task.maxAttempts}`);
                        } else {
                            // 达到最大重试次数
                            this.cloneStats.totalErrors++;
                            console.error(`❌ [顺序模式] 消息 ${task.message.message_id} 处理失败，已达最大重试次数`);
                            
                            await this.dataMapper.logAction(
                                task.config.id,
                                'sequential_clone_failed',
                                'error',
                                cloneResult.error,
                                0,
                                {
                                    source_message_id: task.message.message_id,
                                    attempts: task.attempts,
                                    final_error: cloneResult.error
                                }
                            );
                        }
                    }
                }

                // 添加消息间隔，避免过快发送
                if (queueInfo.queue.length > 0) {
                    await this.sleep(1000); // 1秒间隔
                }

            } catch (error) {
                console.error(`❌ [顺序模式] 处理任务失败:`, error);
                
                // 记录错误
                await this.dataMapper.logAction(
                    task.config.id,
                    'sequential_processing_error',
                    'error',
                    error.message,
                    0,
                    {
                        source_message_id: task.message.message_id,
                        error: error.message
                    }
                );
            }
        }

        queueInfo.processing = false;
        console.log(`📺 [顺序模式] 配置 ${configId} 的队列处理完成`);
    }

    /**
     * 处理延时任务
     */
    async processDelayedTask(task) {
        try {
            console.log(`📺 [延时模式] 开始处理延时消息 ${task.message.message_id}`);
            
            // 执行克隆
            const cloneResult = await this.cloneMessage(task.config, task.message);
            
            if (cloneResult.success) {
                // 创建消息映射
                await this.dataMapper.createMessageMapping(
                    task.config.id,
                    task.message.message_id,
                    cloneResult.targetMessageId,
                    this.getMessageType(task.message)
                );

                this.cloneStats.totalCloned++;
                this.cloneStats.lastCloneTime = new Date();

                console.log(`✅ [延时模式] 消息克隆成功: ${task.message.message_id} -> ${cloneResult.targetMessageId}`);
                
                // 记录成功日志
                await this.dataMapper.logAction(
                    task.config.id,
                    'delayed_clone_success',
                    'success',
                    null,
                    cloneResult.processingTime,
                    {
                        source_message_id: task.message.message_id,
                        target_message_id: cloneResult.targetMessageId,
                        message_type: this.getMessageType(task.message),
                        delay_executed: true
                    }
                );
            } else {
                this.cloneStats.totalErrors++;
                console.error(`❌ [延时模式] 消息克隆失败: ${cloneResult.error}`);
                
                // 记录错误日志
                await this.dataMapper.logAction(
                    task.config.id,
                    'delayed_clone_failed',
                    'error',
                    cloneResult.error,
                    cloneResult.processingTime || 0,
                    {
                        source_message_id: task.message.message_id,
                        message_type: this.getMessageType(task.message),
                        error: cloneResult.error
                    }
                );
            }
        } catch (error) {
            console.error(`❌ [延时模式] 处理延时任务失败:`, error);
            
            await this.dataMapper.logAction(
                task.config.id,
                'delayed_processing_error',
                'error',
                error.message,
                0,
                {
                    source_message_id: task.message.message_id,
                    error: error.message
                }
            );
        }
    }

    /**
     * 添加媒体组到处理队列（支持延时和顺序处理）
     */
    async addMediaGroupToProcessingQueue(mediaGroupId, delaySeconds, sequentialMode) {
        const mediaGroup = this.mediaGroups.get(mediaGroupId);
        if (!mediaGroup) {
            return;
        }

        const config = mediaGroup.config;
        const configId = config.id;
        const executeTime = Date.now() + (delaySeconds * 1000);
        
        const task = {
            id: `${configId}_${mediaGroupId}_${Date.now()}`,
            configId,
            config,
            mediaGroupId,
            executeTime,
            attempts: 0,
            maxAttempts: 3,
            isMediaGroup: true
        };

        if (sequentialMode) {
            // 顺序处理模式
            if (!this.sequentialQueues.has(configId)) {
                this.sequentialQueues.set(configId, {
                    queue: [],
                    processing: false
                });
            }
            
            const queueInfo = this.sequentialQueues.get(configId);
            queueInfo.queue.push(task);
            
            console.log(`📺 [顺序模式] 媒体组 ${mediaGroupId} 已添加到队列，队列长度: ${queueInfo.queue.length}`);
            
            // 如果当前没有在处理，立即开始处理
            if (!queueInfo.processing) {
                this.processSequentialQueue(configId);
            }
        } else {
            // 延时处理模式
            console.log(`📺 [延时模式] 媒体组 ${mediaGroupId} 将在 ${delaySeconds} 秒后处理`);
            
            setTimeout(async () => {
                await this.processDelayedMediaGroupTask(task);
            }, delaySeconds * 1000);
        }

        // 记录日志
        await this.dataMapper.logAction(
            config.id,
            sequentialMode ? 'media_group_queued_sequential' : 'media_group_queued_delayed',
            'info',
            null,
            0,
            {
                media_group_id: mediaGroupId,
                delay_seconds: delaySeconds,
                sequential_mode: sequentialMode,
                message_count: mediaGroup.messages.length
            }
        );
    }

    /**
     * 处理延时媒体组任务
     */
    async processDelayedMediaGroupTask(task) {
        try {
            console.log(`📺 [延时模式] 开始处理延时媒体组 ${task.mediaGroupId}`);
            
            // 执行媒体组处理
            await this.processMediaGroup(task.mediaGroupId);
            
        } catch (error) {
            console.error(`❌ [延时模式] 处理延时媒体组任务失败:`, error);
            
            await this.dataMapper.logAction(
                task.config.id,
                'delayed_media_group_error',
                'error',
                error.message,
                0,
                {
                    media_group_id: task.mediaGroupId,
                    error: error.message
                }
            );
        }
    }

    /**
     * 获取队列状态
     */
    getQueueStatus() {
        const status = {
            sequentialQueues: {},
            totalPendingTasks: 0,
            mediaGroups: {
                active: this.mediaGroups.size,
                processed: this.processedMediaGroups.size
            }
        };

        for (const [configId, queueInfo] of this.sequentialQueues.entries()) {
            status.sequentialQueues[configId] = {
                queueLength: queueInfo.queue.length,
                processing: queueInfo.processing,
                nextTask: queueInfo.queue.length > 0 ? {
                    id: queueInfo.queue[0].id,
                    isMediaGroup: queueInfo.queue[0].isMediaGroup || false,
                    messageId: queueInfo.queue[0].message?.message_id,
                    mediaGroupId: queueInfo.queue[0].mediaGroupId
                } : null
            };
            status.totalPendingTasks += queueInfo.queue.length;
        }

        return status;
    }

    /**
     * 清空指定配置的队列
     */
    clearQueue(configId) {
        let clearedCount = 0;
        
        if (this.sequentialQueues.has(configId)) {
            const queueInfo = this.sequentialQueues.get(configId);
            clearedCount = queueInfo.queue.length;
            queueInfo.queue = [];
            console.log(`📺 已清空配置 ${configId} 的队列，清空了 ${clearedCount} 个任务`);
        }
        
        // 清理相关的媒体组
        for (const [mediaGroupId, mediaGroup] of this.mediaGroups.entries()) {
            if (mediaGroup.config.id === configId) {
                if (mediaGroup.timer) {
                    clearTimeout(mediaGroup.timer);
                }
                this.mediaGroups.delete(mediaGroupId);
                console.log(`📺 清理了媒体组 ${mediaGroupId}`);
            }
        }
        
        return clearedCount;
    }

    /**
     * 强制重置监听器状态
     */
    static resetGlobalState() {
        if (global.channelCloneListenerActive) {
            console.log(`🧹 强制重置全局监听器状态: ${global.channelCloneListenerActive}`);
            global.channelCloneListenerActive = null;
        }
        if (global.channelCloneProcessedMessages) {
            global.channelCloneProcessedMessages.clear();
            console.log(`🧹 清理全局消息去重记录`);
        }
    }
}

module.exports = ChannelCloneService;