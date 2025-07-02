const ChannelDataMapper = require('../models/channelDataMapper');

/**
 * 频道配置管理服务
 * 负责管理频道克隆配置，支持动态配置，不硬编码频道ID
 */
class ChannelConfigService {
    constructor() {
        this.dataMapper = new ChannelDataMapper();
        this.configCache = new Map(); // 配置缓存
        this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存过期
    }

    /**
     * 获取所有频道配置
     */
    async getAllConfigs() {
        try {
            const configs = await this.dataMapper.getAllChannelConfigs();
            console.log(`📺 获取到 ${configs.length} 个频道配置`);
            return configs;
        } catch (error) {
            console.error('获取所有频道配置失败:', error);
            return [];
        }
    }

    /**
     * 获取启用的频道配置
     */
    async getEnabledConfigs() {
        try {
            const configs = await this.dataMapper.getEnabledChannelConfigs();
            console.log(`📺 获取到 ${configs.length} 个启用的频道配置`);
            return configs;
        } catch (error) {
            console.error('获取启用的频道配置失败:', error);
            return [];
        }
    }

    /**
     * 根据配置名称获取配置
     */
    async getConfig(configName) {
        try {
            // 检查缓存
            const cacheKey = `config_${configName}`;
            const cached = this.configCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                return cached.data;
            }

            const config = await this.dataMapper.getChannelConfig(configName);
            
            // 更新缓存
            if (config) {
                this.configCache.set(cacheKey, {
                    data: config,
                    timestamp: Date.now()
                });
            }

            return config;
        } catch (error) {
            console.error('获取频道配置失败:', error);
            return null;
        }
    }

    /**
     * 根据源频道ID获取配置
     */
    async getConfigBySourceChannel(sourceChannelId) {
        try {
            const config = await this.dataMapper.getConfigBySourceChannel(sourceChannelId);
            return config;
        } catch (error) {
            console.error('根据源频道ID获取配置失败:', error);
            return null;
        }
    }

    /**
     * 创建或更新频道配置
     */
    async saveConfig(configData) {
        try {
            // 验证配置数据
            const validation = this.dataMapper.validateConfigData(configData);
            if (!validation.valid) {
                return {
                    success: false,
                    errors: validation.errors
                };
            }

            // 检查源频道和目标频道是否已被其他配置使用
            const conflicts = await this.checkChannelConflicts(configData);
            if (conflicts.length > 0) {
                return {
                    success: false,
                    errors: conflicts
                };
            }

            const savedConfig = await this.dataMapper.saveChannelConfig(configData);
            
            if (savedConfig) {
                // 清除相关缓存
                this.clearConfigCache(configData.name);
                
                // 记录操作日志
                await this.dataMapper.logAction(
                    savedConfig.id,
                    'config_save',
                    'success',
                    null,
                    0,
                    { config_name: configData.name, action: 'save' }
                );

                console.log(`📺 频道配置 ${configData.name} 保存成功`);
                
                return {
                    success: true,
                    config: savedConfig
                };
            } else {
                return {
                    success: false,
                    errors: ['保存配置失败']
                };
            }
        } catch (error) {
            console.error('保存频道配置失败:', error);
            return {
                success: false,
                errors: ['系统错误，请稍后重试']
            };
        }
    }

    /**
     * 删除频道配置
     */
    async deleteConfig(configName) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            const success = await this.dataMapper.deleteChannelConfig(configName);
            
            if (success) {
                // 清除缓存
                this.clearConfigCache(configName);
                
                // 记录操作日志
                await this.dataMapper.logAction(
                    config.id,
                    'config_delete',
                    'success',
                    null,
                    0,
                    { config_name: configName, action: 'delete' }
                );

                console.log(`📺 频道配置 ${configName} 删除成功`);
                
                return { success: true };
            } else {
                return {
                    success: false,
                    error: '删除配置失败'
                };
            }
        } catch (error) {
            console.error('删除频道配置失败:', error);
            return {
                success: false,
                error: '系统错误，请稍后重试'
            };
        }
    }

    /**
     * 启用/禁用频道配置
     */
    async toggleConfig(configName, enabled) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            const success = await this.dataMapper.eavOps.updateChannelConfig(configName, {
                clone_enabled: enabled
            });

            if (success) {
                // 清除缓存
                this.clearConfigCache(configName);
                
                // 记录操作日志
                await this.dataMapper.logAction(
                    config.id,
                    enabled ? 'config_enable' : 'config_disable',
                    'success',
                    null,
                    0,
                    { config_name: configName, enabled }
                );

                console.log(`📺 频道配置 ${configName} ${enabled ? '启用' : '禁用'}成功`);
                
                return { success: true };
            } else {
                return {
                    success: false,
                    error: '更新配置失败'
                };
            }
        } catch (error) {
            console.error('切换频道配置状态失败:', error);
            return {
                success: false,
                error: '系统错误，请稍后重试'
            };
        }
    }

    /**
     * 获取配置运行状态
     */
    async getConfigStatus(configName) {
        try {
            const status = await this.dataMapper.getConfigStatus(configName);
            return status;
        } catch (error) {
            console.error('获取配置状态失败:', error);
            return { status: 'error', message: '获取状态失败' };
        }
    }

    /**
     * 检查频道冲突
     */
    async checkChannelConflicts(configData) {
        try {
            const allConfigs = await this.getAllConfigs();
            const conflicts = [];

            for (const existingConfig of allConfigs) {
                // 跳过自己
                if (existingConfig.name === configData.name) {
                    continue;
                }

                // 检查源频道冲突
                if (existingConfig.sourceChannel.id === configData.sourceChannelId) {
                    conflicts.push(`源频道 ${configData.sourceChannelId} 已被配置 "${existingConfig.name}" 使用`);
                }

                // 检查目标频道冲突
                if (existingConfig.targetChannel.id === configData.targetChannelId) {
                    conflicts.push(`目标频道 ${configData.targetChannelId} 已被配置 "${existingConfig.name}" 使用`);
                }

                // 检查是否有反向配置（A->B 和 B->A）
                if (existingConfig.sourceChannel.id === configData.targetChannelId && 
                    existingConfig.targetChannel.id === configData.sourceChannelId) {
                    conflicts.push(`存在反向配置冲突，配置 "${existingConfig.name}" 已设置反向克隆`);
                }
            }

            return conflicts;
        } catch (error) {
            console.error('检查频道冲突失败:', error);
            return [];
        }
    }

    /**
     * 获取频道信息（通过Bot API）
     */
    async getChannelInfo(channelId, bot) {
        try {
            if (!bot) {
                return {
                    id: channelId,
                    title: '未知频道',
                    username: '',
                    type: 'channel'
                };
            }

            const chat = await bot.getChat(channelId);
            return {
                id: chat.id,
                title: chat.title || chat.first_name || '未知',
                username: chat.username || '',
                type: chat.type,
                description: chat.description || ''
            };
        } catch (error) {
            console.error(`获取频道信息失败 ${channelId}:`, error.message);
            return {
                id: channelId,
                title: '频道信息获取失败',
                username: '',
                type: 'channel',
                error: error.message
            };
        }
    }

    /**
     * 验证频道权限
     */
    async validateChannelPermissions(channelId, bot) {
        try {
            if (!bot) {
                return { valid: false, error: 'Bot未初始化' };
            }

            // 获取Bot在频道中的权限
            const chatMember = await bot.getChatMember(channelId, bot.options.botId || 'self');
            
            const requiredPermissions = [
                'can_post_messages',
                'can_edit_messages',
                'can_delete_messages'
            ];

            const missingPermissions = [];
            
            if (chatMember.status === 'administrator') {
                // 检查管理员权限
                for (const permission of requiredPermissions) {
                    if (!chatMember[permission]) {
                        missingPermissions.push(permission);
                    }
                }
            } else if (chatMember.status !== 'creator') {
                return { 
                    valid: false, 
                    error: 'Bot需要是频道管理员才能进行克隆操作' 
                };
            }

            if (missingPermissions.length > 0) {
                return {
                    valid: false,
                    error: `Bot缺少以下权限: ${missingPermissions.join(', ')}`
                };
            }

            return { valid: true };
        } catch (error) {
            console.error(`验证频道权限失败 ${channelId}:`, error.message);
            return {
                valid: false,
                error: `无法验证频道权限: ${error.message}`
            };
        }
    }

    /**
     * 测试配置连通性
     */
    async testConfig(configName, bot) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            const results = {
                sourceChannel: null,
                targetChannel: null,
                permissions: null
            };

            // 测试源频道
            try {
                results.sourceChannel = await this.getChannelInfo(config.sourceChannel.id, bot);
                results.sourceChannel.accessible = !results.sourceChannel.error;
            } catch (error) {
                results.sourceChannel = {
                    id: config.sourceChannel.id,
                    accessible: false,
                    error: error.message
                };
            }

            // 测试目标频道
            try {
                results.targetChannel = await this.getChannelInfo(config.targetChannel.id, bot);
                results.targetChannel.accessible = !results.targetChannel.error;
                
                // 验证目标频道权限
                if (results.targetChannel.accessible) {
                    results.permissions = await this.validateChannelPermissions(config.targetChannel.id, bot);
                }
            } catch (error) {
                results.targetChannel = {
                    id: config.targetChannel.id,
                    accessible: false,
                    error: error.message
                };
            }

            const allGood = results.sourceChannel?.accessible && 
                          results.targetChannel?.accessible && 
                          results.permissions?.valid;

            return {
                success: allGood,
                results,
                message: allGood ? '配置测试通过' : '配置测试发现问题'
            };
        } catch (error) {
            console.error('测试配置失败:', error);
            return {
                success: false,
                error: '系统错误，请稍后重试'
            };
        }
    }

    /**
     * 获取历史消息
     */
    async getHistoryMessages(configName, bot, limit = 100) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            if (!bot) {
                return {
                    success: false,
                    error: 'Bot未初始化'
                };
            }

            // 获取源频道的历史消息
            const sourceChannelId = config.sourceChannel.id;
            
            console.log(`📜 获取频道 ${sourceChannelId} 的历史消息，限制 ${limit} 条`);
            
            // 使用getUpdates方法获取历史消息
            // 注意：这个方法可能需要根据实际的Bot API来调整
            const messages = await this.getChannelHistory(sourceChannelId, bot, limit);
            
            return {
                success: true,
                data: messages
            };
        } catch (error) {
            console.error('获取历史消息失败:', error);
            return {
                success: false,
                error: '获取历史消息失败: ' + error.message
            };
        }
    }

    /**
     * 扫描并克隆历史消息
     */
    async scanAndCloneHistory(configName, bot, options = {}) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            const {
                startMessageId = 1,
                endMessageId = null,
                maxMessages = 100,
                delayMs = 1000,
                skipExisting = true
            } = options;

            const sourceChannelId = config.sourceChannel.id;
            const targetChannelId = config.targetChannel.id;
            
            console.log(`🔍 开始扫描历史消息: ${sourceChannelId} -> ${targetChannelId}`);
            console.log(`📊 扫描范围: ${startMessageId} 到 ${endMessageId || '最新'}`);

            let scannedCount = 0;
            let foundCount = 0;
            let clonedCount = 0;
            let errorCount = 0;
            let currentMessageId = startMessageId;

            // 如果没有指定结束ID，尝试获取最新消息ID
            let maxMessageId = endMessageId;
            if (!maxMessageId) {
                maxMessageId = await this.getLatestMessageId(sourceChannelId, bot);
                if (!maxMessageId) {
                    maxMessageId = startMessageId + maxMessages;
                }
            }

            const results = [];

            while (currentMessageId <= maxMessageId && foundCount < maxMessages) {
                try {
                    // 尝试获取特定消息
                    const message = await this.getMessageById(sourceChannelId, currentMessageId, bot);
                    
                    if (message) {
                        foundCount++;
                        console.log(`📨 找到消息 #${currentMessageId}: ${message.text?.substring(0, 50) || '[媒体消息]'}...`);

                        // 检查是否已经克隆过
                        if (skipExisting) {
                            const existingMapping = await this.dataMapper.getMessageMapping(currentMessageId, config.id);
                            if (existingMapping) {
                                console.log(`⏭️ 跳过已克隆的消息 #${currentMessageId}`);
                                results.push({
                                    messageId: currentMessageId,
                                    status: 'skipped',
                                    reason: '已存在'
                                });
                                currentMessageId++;
                                continue;
                            }
                        }

                        // 克隆消息
                        const cloneResult = await this.cloneHistoryMessage(
                            config,
                            message,
                            bot
                        );

                        if (cloneResult.success) {
                            clonedCount++;
                            results.push({
                                messageId: currentMessageId,
                                status: 'success',
                                targetMessageId: cloneResult.targetMessageId
                            });
                            console.log(`✅ 成功克隆消息 #${currentMessageId} -> #${cloneResult.targetMessageId}`);
                        } else {
                            errorCount++;
                            results.push({
                                messageId: currentMessageId,
                                status: 'error',
                                error: cloneResult.error
                            });
                            console.log(`❌ 克隆失败 #${currentMessageId}: ${cloneResult.error}`);
                        }

                        // 添加延迟避免API限制
                        if (delayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        }
                    }

                    scannedCount++;
                    currentMessageId++;

                } catch (error) {
                    console.log(`🔍 消息 #${currentMessageId} 不存在或无法访问`);
                    currentMessageId++;
                    scannedCount++;
                }

                // 每扫描100条消息输出进度
                if (scannedCount % 100 === 0) {
                    console.log(`📊 扫描进度: ${scannedCount}/${maxMessageId - startMessageId + 1}, 找到: ${foundCount}, 克隆: ${clonedCount}`);
                }
            }

            // 记录扫描日志
            await this.dataMapper.logAction(
                config.id,
                'history_scan',
                'success',
                null,
                0,
                {
                    scanned_count: scannedCount,
                    found_count: foundCount,
                    cloned_count: clonedCount,
                    error_count: errorCount,
                    scan_range: `${startMessageId}-${currentMessageId - 1}`
                }
            );

            console.log(`🎉 历史消息扫描完成!`);
            console.log(`📊 统计: 扫描${scannedCount}条, 找到${foundCount}条, 克隆${clonedCount}条, 失败${errorCount}条`);

            return {
                success: true,
                data: {
                    scannedCount,
                    foundCount,
                    clonedCount,
                    errorCount,
                    results
                }
            };

        } catch (error) {
            console.error('扫描历史消息失败:', error);
            return {
                success: false,
                error: '扫描失败: ' + error.message
            };
        }
    }

    /**
     * 获取特定消息ID的消息
     */
    async getMessageById(channelId, messageId, bot) {
        try {
            // 方法1: 尝试转发消息到自己来获取消息内容
            const botInfo = await bot.getMe();
            const forwardResult = await bot.forwardMessage(
                botInfo.id, // 转发给bot自己
                channelId,
                messageId
            );

            if (forwardResult) {
                // 获取转发的消息内容
                const message = {
                    message_id: messageId,
                    date: forwardResult.date,
                    text: forwardResult.text,
                    caption: forwardResult.caption,
                    photo: forwardResult.photo,
                    video: forwardResult.video,
                    document: forwardResult.document,
                    audio: forwardResult.audio,
                    voice: forwardResult.voice,
                    sticker: forwardResult.sticker,
                    animation: forwardResult.animation,
                    from: forwardResult.forward_origin?.sender_user || forwardResult.forward_origin?.sender_chat,
                    chat: { id: channelId, type: 'channel' }
                };

                // 删除转发给自己的消息
                try {
                    await bot.deleteMessage(botInfo.id, forwardResult.message_id);
                } catch (deleteError) {
                    console.warn('删除临时转发消息失败:', deleteError.message);
                }

                return message;
            }

            return null;
        } catch (error) {
            // 如果转发失败，说明消息不存在或无权限
            return null;
        }
    }

    /**
     * 获取频道最新消息ID
     */
    async getLatestMessageId(channelId, bot) {
        try {
            // 尝试获取频道信息
            const chat = await bot.getChat(channelId);
            
            // 如果是频道，尝试获取最近的消息
            // 这里我们使用一个大概的数字，实际应用中可以根据频道创建时间估算
            const now = Date.now();
            const channelCreatedTime = new Date('2020-01-01').getTime(); // 假设频道创建时间
            const daysSinceCreated = Math.floor((now - channelCreatedTime) / (1000 * 60 * 60 * 24));
            
            // 估算最大消息ID (每天平均10条消息)
            const estimatedMaxId = Math.min(daysSinceCreated * 10, 10000);
            
            console.log(`📊 估算频道 ${channelId} 最大消息ID: ${estimatedMaxId}`);
            return estimatedMaxId;
            
        } catch (error) {
            console.warn('获取最新消息ID失败:', error.message);
            return 1000; // 默认值
        }
    }

    /**
     * 克隆历史消息
     */
    async cloneHistoryMessage(config, message, bot) {
        try {
            const sourceChannelId = config.sourceChannel.id;
            const targetChannelId = config.targetChannel.id;
            const messageId = message.message_id;

            console.log(`🚀 克隆历史消息 ${messageId} 从 ${sourceChannelId} 到 ${targetChannelId}`);

            // 使用copyMessage API克隆消息
            const result = await bot.copyMessage(
                targetChannelId,
                sourceChannelId,
                messageId
            );

            if (result && result.message_id) {
                // 记录消息映射
                await this.dataMapper.createMessageMapping(
                    config.id,
                    messageId,
                    result.message_id,
                    'history_clone'
                );

                return {
                    success: true,
                    targetMessageId: result.message_id
                };
            } else {
                return {
                    success: false,
                    error: '克隆失败，未获取到目标消息ID'
                };
            }

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 获取频道历史消息的辅助方法
     */
    async getChannelHistory(channelId, bot, limit) {
        try {
            console.log(`📜 获取频道 ${channelId} 的历史消息，限制 ${limit} 条`);
            
            let messages = [];
            
            try {
                // 获取频道信息，确认Bot有权限访问
                const chatInfo = await bot.getChat(channelId);
                console.log(`📜 频道信息: ${chatInfo.title || chatInfo.id}`);
                
                // 🔥 重要：Bot API无法直接获取频道历史消息！
                // 根据官方文档，Bot只能：
                // 1. 监听实时消息 (channel_post事件)
                // 2. 通过具体消息ID获取消息 (channels.getMessages)
                // 3. 无法使用 messages.getHistory (仅限用户客户端)
                
                console.log(`⚠️ Bot API限制说明：`);
                console.log(`   - Bot无法直接获取频道历史消息`);
                console.log(`   - 只能通过监听实时消息或具体消息ID获取`);
                console.log(`   - messages.getHistory方法仅限用户客户端使用`);
                
                // 尝试获取频道的最新消息（如果有的话）
                // 这是一个变通方法：尝试获取最近可能的消息ID
                const recentMessages = await this.tryGetRecentMessages(channelId, bot, limit);
                
                if (recentMessages.length > 0) {
                    console.log(`📜 通过变通方法找到 ${recentMessages.length} 条最近消息`);
                    messages = recentMessages;
                } else {
                    console.log(`📜 无法获取历史消息，建议：`);
                    console.log(`   1. 启用实时监听以捕获新消息`);
                    console.log(`   2. 等待频道发布新消息后进行克隆`);
                    console.log(`   3. 如需历史消息，请使用用户客户端而非Bot`);
                }
                
            } catch (error) {
                console.error(`❌ 获取频道信息失败:`, error.message);
                
                if (error.message.includes('chat not found') || error.message.includes('CHAT_ID_INVALID')) {
                    throw new Error(`频道ID无效或Bot无权限访问频道 ${channelId}`);
                } else if (error.message.includes('CHANNEL_PRIVATE')) {
                    throw new Error(`频道 ${channelId} 是私有的，Bot无权限访问`);
                } else {
                    throw new Error(`无法访问频道 ${channelId}: ${error.message}`);
                }
            }
            
            console.log(`📜 最终返回 ${messages.length} 条消息`);
            return {
                success: true,
                messages: messages,
                total: messages.length,
                limitation: 'Bot API无法获取频道历史消息，只能获取实时消息或通过具体消息ID获取'
            };
            
        } catch (error) {
            console.error(`❌ 获取历史消息失败:`, error);
            return {
                success: false,
                error: error.message,
                messages: [],
                total: 0
            };
        }
    }

    /**
     * 尝试获取最近的消息（变通方法）
     * 🔥 改进版：更智能的消息扫描策略
     */
    async tryGetRecentMessages(channelId, bot, limit) {
        const messages = [];
        
        try {
            console.log(`📜 开始智能扫描频道 ${channelId} 的历史消息...`);
            
            // 🔥 策略1: 二分查找最新消息ID
            const latestMessageId = await this.findLatestMessageId(channelId, bot);
            if (!latestMessageId) {
                console.log(`⚠️ 无法找到任何消息，频道可能为空或无权限`);
                return [];
            }
            
            console.log(`📊 找到最新消息ID: ${latestMessageId}`);
            
            // 🔥 策略2: 从最新消息向前扫描
            const scanRange = Math.min(limit * 10, 500); // 扫描范围
            let foundCount = 0;
            
            for (let offset = 0; offset < scanRange && foundCount < limit; offset++) {
                const messageId = latestMessageId - offset;
                if (messageId <= 0) break;
                
                try {
                    // 使用copyMessage测试消息是否存在
                    const exists = await this.testMessageExistsQuick(channelId, messageId, bot);
                    
                    if (exists) {
                        // 构造消息对象
                        messages.push({
                            message_id: messageId,
                            chat: { id: channelId },
                            date: Math.floor(Date.now() / 1000) - (offset * 60), // 估算时间
                            text: `历史消息 #${messageId}`,
                            found_method: 'smart_scan'
                        });
                        
                        foundCount++;
                        console.log(`📜 找到消息 #${messageId} (${foundCount}/${limit})`);
                    }
                } catch (error) {
                    // 消息不存在，继续扫描
                    continue;
                }
                
                // 每10条消息报告一次进度
                if ((offset + 1) % 10 === 0) {
                    console.log(`📊 扫描进度: ${offset + 1}/${scanRange}, 已找到: ${foundCount}`);
                }
                
                // 添加延迟避免API限制
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // 按消息ID排序（最新的在前）
            messages.sort((a, b) => b.message_id - a.message_id);
            
            console.log(`✅ 智能扫描完成: 找到 ${messages.length} 条消息`);
            if (messages.length > 0) {
                console.log(`📜 消息ID范围: ${messages[messages.length-1].message_id} - ${messages[0].message_id}`);
            }
            
            return messages;
            
        } catch (error) {
            console.error(`❌ 智能扫描失败:`, error);
            return [];
        }
    }

    /**
     * 🔥 新增：二分查找最新消息ID
     */
    async findLatestMessageId(channelId, bot) {
        try {
            console.log(`🔍 使用二分查找寻找频道 ${channelId} 的最新消息ID...`);
            
            // 设置搜索范围
            let low = 1;
            let high = 10000; // 初始上限
            let latestFound = 0;
            
            // 首先找到一个存在的消息作为起点
            console.log(`📊 第一阶段：寻找存在的消息...`);
            for (let testId of [1, 10, 50, 100, 200, 500, 1000]) {
                const exists = await this.testMessageExistsQuick(channelId, testId, bot);
                if (exists) {
                    latestFound = testId;
                    low = testId;
                    console.log(`✅ 找到基准消息ID: ${testId}`);
                    break;
                }
            }
            
            if (latestFound === 0) {
                console.log(`⚠️ 未找到任何消息，频道可能为空`);
                return null;
            }
            
            // 向上扩展搜索范围，找到上界
            console.log(`📊 第二阶段：寻找上界...`);
            while (high < 100000) {
                const exists = await this.testMessageExistsQuick(channelId, high, bot);
                if (exists) {
                    latestFound = high;
                    low = high;
                    high *= 2; // 继续向上扩展
                    console.log(`📈 扩展上界到: ${high}`);
                } else {
                    break; // 找到上界
                }
            }
            
            // 二分查找精确的最新消息ID
            console.log(`📊 第三阶段：二分查找最新消息 (${low} - ${high})...`);
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const exists = await this.testMessageExistsQuick(channelId, mid, bot);
                
                if (exists) {
                    latestFound = mid;
                    low = mid + 1;
                    console.log(`✅ 消息 #${mid} 存在，继续向上搜索`);
                } else {
                    high = mid - 1;
                    console.log(`❌ 消息 #${mid} 不存在，向下搜索`);
                }
                
                // 添加延迟避免API限制
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            
            console.log(`🎯 找到最新消息ID: ${latestFound}`);
            return latestFound;
            
        } catch (error) {
            console.error(`❌ 二分查找失败:`, error);
            return null;
        }
    }

    /**
     * 🔥 新增：快速测试消息是否存在
     */
    async testMessageExistsQuick(channelId, messageId, bot) {
        try {
            // 方法1: 尝试转发消息（最可靠但会产生副作用）
            const result = await bot.forwardMessage(
                channelId, // 转发到同一个频道
                channelId, // 从同一个频道
                messageId,
                { disable_notification: true }
            );
            
            if (result) {
                // 立即删除测试消息
                try {
                    await bot.deleteMessage(channelId, result.message_id);
                } catch (deleteError) {
                    // 删除失败不影响测试结果
                }
                return true;
            }
            return false;
        } catch (error) {
            // 如果转发失败，尝试其他方法
            try {
                // 方法2: 尝试使用copyMessage（更安全）
                const result = await bot.copyMessage(
                    channelId, // 复制到同一个频道
                    channelId, // 从同一个频道
                    messageId,
                    { disable_notification: true }
                );
                
                if (result) {
                    // 立即删除测试消息
                    try {
                        await bot.deleteMessage(channelId, result.message_id);
                    } catch (deleteError) {
                        // 删除失败不影响测试结果
                    }
                    return true;
                }
            } catch (copyError) {
                // 两种方法都失败，消息不存在
                return false;
            }
            return false;
        }
    }

    /**
     * 克隆单条消息
     */
    async cloneMessage(configName, messageId, bot) {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            if (!bot) {
                return {
                    success: false,
                    error: 'Bot未初始化'
                };
            }

            const sourceChannelId = config.sourceChannel.id;
            const targetChannelId = config.targetChannel.id;
            
            console.log(`🚀 克隆消息 ${messageId} 从 ${sourceChannelId} 到 ${targetChannelId}`);
            
            // 使用copyMessage API克隆消息
            const result = await bot.copyMessage(
                targetChannelId,
                sourceChannelId,
                messageId
            );
            
            if (result && result.message_id) {
                // 记录消息映射
                await this.dataMapper.createMessageMapping(
                    config.id,
                    messageId,
                    result.message_id,
                    'manual_clone'
                );
                
                // 记录操作日志
                await this.dataMapper.logAction(
                    config.id,
                    'manual_clone',
                    'success',
                    null,
                    0,
                    { 
                        source_message_id: messageId,
                        target_message_id: result.message_id,
                        config_name: configName
                    }
                );
                
                console.log(`✅ 消息克隆成功: ${messageId} -> ${result.message_id}`);
                
                return {
                    success: true,
                    data: {
                        sourceMessageId: messageId,
                        targetMessageId: result.message_id
                    }
                };
            } else {
                return {
                    success: false,
                    error: '克隆失败，未获取到目标消息ID'
                };
            }
        } catch (error) {
            console.error('克隆消息失败:', error);
            
            // 记录错误日志
            try {
                const config = await this.getConfig(configName);
                if (config) {
                    await this.dataMapper.logAction(
                        config.id,
                        'manual_clone',
                        'error',
                        error.message,
                        0,
                        { 
                            source_message_id: messageId,
                            config_name: configName
                        }
                    );
                }
            } catch (logError) {
                console.error('记录错误日志失败:', logError);
            }
            
            return {
                success: false,
                error: '克隆消息失败: ' + error.message
            };
        }
    }

    /**
     * 批量操作配置
     */
    async batchOperation(operation, configNames) {
        const results = [];
        
        for (const configName of configNames) {
            try {
                let result;
                switch (operation) {
                    case 'enable':
                        result = await this.toggleConfig(configName, true);
                        break;
                    case 'disable':
                        result = await this.toggleConfig(configName, false);
                        break;
                    case 'delete':
                        result = await this.deleteConfig(configName);
                        break;
                    default:
                        result = { success: false, error: '未知操作' };
                }
                
                results.push({
                    configName,
                    success: result.success,
                    error: result.error || null
                });
            } catch (error) {
                results.push({
                    configName,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * 获取配置统计信息
     */
    async getConfigStats() {
        try {
            const allConfigs = await this.getAllConfigs();
            
            const stats = {
                total: allConfigs.length,
                enabled: allConfigs.filter(c => c.settings.enabled).length,
                disabled: allConfigs.filter(c => !c.settings.enabled).length,
                active: allConfigs.filter(c => c.status === 'active').length,
                byStatus: {},
                recentActivity: []
            };

            // 按状态分组
            const statusGroups = {};
            for (const config of allConfigs) {
                const status = config.status || 'unknown';
                statusGroups[status] = (statusGroups[status] || 0) + 1;
            }
            stats.byStatus = statusGroups;

            // 获取最近活动
            const recentLogs = await this.dataMapper.getLogs(null, 10);
            stats.recentActivity = recentLogs.filter(log => 
                log.action.startsWith('config_')
            ).slice(0, 5);

            return stats;
        } catch (error) {
            console.error('获取配置统计失败:', error);
            return {
                total: 0,
                enabled: 0,
                disabled: 0,
                active: 0,
                byStatus: {},
                recentActivity: []
            };
        }
    }

    /**
     * 导出频道消息
     */
    async exportChannelMessages(configName, bot, format = 'json') {
        try {
            const config = await this.getConfig(configName);
            if (!config) {
                return {
                    success: false,
                    error: '配置不存在'
                };
            }

            console.log(`📤 开始导出频道 ${config.sourceChannel.id} 的消息`);
            
            // 获取所有可用的消息
            const messages = await this.getChannelHistory(config.sourceChannel.id, bot, 1000);
            
            // 准备导出数据
            const exportData = {
                export_info: {
                    channel_id: config.sourceChannel.id,
                    channel_name: config.name,
                    export_time: new Date().toISOString(),
                    total_messages: messages.length,
                    format: format
                },
                messages: messages.map(msg => ({
                    message_id: msg.message_id,
                    date: new Date(msg.date * 1000).toISOString(),
                    text: msg.text || '',
                    caption: msg.caption || '',
                    media_type: this.getMessageMediaType(msg),
                    from: {
                        id: msg.from?.id,
                        first_name: msg.from?.first_name,
                        username: msg.from?.username,
                        is_bot: msg.from?.is_bot
                    },
                    chat: {
                        id: msg.chat?.id,
                        type: msg.chat?.type,
                        title: msg.chat?.title
                    }
                }))
            };

            // 根据格式生成不同的导出内容
            let exportContent;
            let filename;
            let contentType;

            switch (format.toLowerCase()) {
                case 'json':
                    exportContent = JSON.stringify(exportData, null, 2);
                    filename = `channel_export_${configName}_${new Date().toISOString().split('T')[0]}.json`;
                    contentType = 'application/json';
                    break;
                
                case 'csv':
                    exportContent = this.convertToCSV(exportData.messages);
                    filename = `channel_export_${configName}_${new Date().toISOString().split('T')[0]}.csv`;
                    contentType = 'text/csv';
                    break;
                
                case 'txt':
                    exportContent = this.convertToText(exportData);
                    filename = `channel_export_${configName}_${new Date().toISOString().split('T')[0]}.txt`;
                    contentType = 'text/plain';
                    break;
                
                default:
                    exportContent = JSON.stringify(exportData, null, 2);
                    filename = `channel_export_${configName}_${new Date().toISOString().split('T')[0]}.json`;
                    contentType = 'application/json';
            }

            console.log(`📤 导出完成，包含 ${messages.length} 条消息`);

            return {
                success: true,
                data: {
                    content: exportContent,
                    filename: filename,
                    contentType: contentType,
                    messageCount: messages.length
                }
            };

        } catch (error) {
            console.error('导出频道消息失败:', error);
            return {
                success: false,
                error: '导出失败: ' + error.message
            };
        }
    }

    /**
     * 获取消息媒体类型
     */
    getMessageMediaType(message) {
        if (message.photo) return 'photo';
        if (message.video) return 'video';
        if (message.document) return 'document';
        if (message.audio) return 'audio';
        if (message.voice) return 'voice';
        if (message.sticker) return 'sticker';
        if (message.animation) return 'animation';
        if (message.location) return 'location';
        if (message.contact) return 'contact';
        if (message.poll) return 'poll';
        return 'text';
    }

    /**
     * 转换为CSV格式
     */
    convertToCSV(messages) {
        const headers = ['Message ID', 'Date', 'From', 'Text', 'Media Type'];
        const rows = [headers.join(',')];

        messages.forEach(msg => {
            const row = [
                msg.message_id,
                msg.date,
                `"${msg.from?.first_name || 'Unknown'}"`,
                `"${(msg.text || '').replace(/"/g, '""')}"`,
                msg.media_type
            ];
            rows.push(row.join(','));
        });

        return rows.join('\n');
    }

    /**
     * 转换为文本格式
     */
    convertToText(exportData) {
        let content = `频道消息导出\n`;
        content += `===============\n`;
        content += `频道ID: ${exportData.export_info.channel_id}\n`;
        content += `配置名称: ${exportData.export_info.channel_name}\n`;
        content += `导出时间: ${exportData.export_info.export_time}\n`;
        content += `消息总数: ${exportData.export_info.total_messages}\n`;
        content += `===============\n\n`;

        exportData.messages.forEach((msg, index) => {
            content += `消息 #${msg.message_id}\n`;
            content += `时间: ${msg.date}\n`;
            content += `发送者: ${msg.from?.first_name || 'Unknown'}\n`;
            content += `类型: ${msg.media_type}\n`;
            if (msg.text) {
                content += `内容: ${msg.text}\n`;
            }
            content += `---\n\n`;
        });

        return content;
    }

    /**
     * 导出配置
     */
    async exportConfigs(configNames = null) {
        try {
            let configs;
            if (configNames && configNames.length > 0) {
                configs = [];
                for (const name of configNames) {
                    const config = await this.getConfig(name);
                    if (config) {
                        configs.push(config);
                    }
                }
            } else {
                configs = await this.getAllConfigs();
            }

            const exportData = {
                version: '1.0.0',
                exportTime: new Date().toISOString(),
                configCount: configs.length,
                configs: configs.map(config => ({
                    name: config.name,
                    sourceChannelId: config.sourceChannel.id,
                    targetChannelId: config.targetChannel.id,
                    settings: config.settings,
                    createdAt: config.createdAt
                }))
            };

            return exportData;
        } catch (error) {
            console.error('导出配置失败:', error);
            return null;
        }
    }

    /**
     * 导入配置
     */
    async importConfigs(importData, options = {}) {
        const { overwrite = false, skipExisting = true } = options;
        const results = [];

        try {
            if (!importData.configs || !Array.isArray(importData.configs)) {
                return {
                    success: false,
                    error: '导入数据格式错误'
                };
            }

            for (const configData of importData.configs) {
                try {
                    const existing = await this.getConfig(configData.name);
                    
                    if (existing && !overwrite && skipExisting) {
                        results.push({
                            name: configData.name,
                            success: false,
                            error: '配置已存在，跳过'
                        });
                        continue;
                    }

                    const result = await this.saveConfig({
                        name: configData.name,
                        sourceChannelId: configData.sourceChannelId,
                        targetChannelId: configData.targetChannelId,
                        enabled: configData.settings.enabled,
                        syncEdits: configData.settings.syncEdits,
                        filterEnabled: configData.settings.filterEnabled,
                        rateLimit: configData.settings.rateLimit,
                        rules: configData.settings.rules
                    });

                    results.push({
                        name: configData.name,
                        success: result.success,
                        error: result.success ? null : result.errors?.join(', ')
                    });
                } catch (error) {
                    results.push({
                        name: configData.name,
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            
            return {
                success: successCount > 0,
                total: results.length,
                successCount,
                failedCount: results.length - successCount,
                results
            };
        } catch (error) {
            console.error('导入配置失败:', error);
            return {
                success: false,
                error: '导入过程中发生错误'
            };
        }
    }

    /**
     * 清除配置缓存
     */
    clearConfigCache(configName = null) {
        if (configName) {
            this.configCache.delete(`config_${configName}`);
        } else {
            this.configCache.clear();
        }
    }

    /**
     * 获取缓存统计
     */
    getCacheStats() {
        return {
            size: this.configCache.size,
            expiry: this.cacheExpiry,
            keys: Array.from(this.configCache.keys())
        };
    }

    /**
     * 扫描频道历史消息并克隆
     */
    async scanChannelHistory(configName, options = {}) {
        const config = await this.getConfig(configName);
        if (!config || !config.settings.enabled) {
            throw new Error('配置不存在或未启用');
        }

        const {
            startMessageId = 1,
            endMessageId = null,
            maxMessages = 100,
            delayMs = 1000,
            skipExisting = true
        } = options;

        console.log(`🔍 开始扫描历史消息: ${configName}`, {
            startMessageId,
            endMessageId,
            maxMessages,
            delayMs,
            skipExisting
        });

        // ⚠️ 重要说明：Bot API限制
        console.log(`⚠️ Bot API限制说明：`);
        console.log(`   - Telegram Bot API无法直接获取频道历史消息`);
        console.log(`   - 此功能为实验性质，成功率有限`);
        console.log(`   - 建议启用实时监听来捕获新消息`);
        console.log(`   - 如需完整历史消息，请使用用户客户端`);

        const sourceChannelId = config.sourceChannel.id;
        const targetChannelId = config.targetChannel.id;

        console.log(`🔍 开始扫描历史消息: ${sourceChannelId} -> ${targetChannelId}`);
        console.log(`📊 扫描范围: ${startMessageId} 到 ${endMessageId || '最新'}`);

        // 设置扫描状态
        const scanStatus = {
            configName,
            isRunning: true,
            startTime: new Date(),
            currentId: startMessageId,
            endId: endMessageId,
            scannedCount: 0,
            foundCount: 0,
            clonedCount: 0,
            errors: [],
            maxMessages
        };

        // 存储扫描状态
        if (!global.channelScanStatus) {
            global.channelScanStatus = new Map();
        }
        global.channelScanStatus.set(configName, scanStatus);

        try {
            // 估算最大消息ID（如果未指定结束ID）
            let maxId = endMessageId;
            if (!maxId) {
                maxId = Math.min(startMessageId + maxMessages * 10, 10000); // 保守估算
                console.log(`📊 估算频道 ${sourceChannelId} 最大消息ID: ${maxId}`);
            }

            let currentId = startMessageId;
            let foundMessages = 0;
            let clonedMessages = 0;

            while (currentId <= maxId && foundMessages < maxMessages && scanStatus.isRunning) {
                scanStatus.currentId = currentId;
                scanStatus.scannedCount++;

                try {
                    // ⚠️ 注意：这种方法成功率很低，因为Bot API限制
                    // 尝试通过转发测试消息是否存在
                    const exists = await this.testMessageExists(sourceChannelId, currentId);
                    
                    if (exists) {
                        foundMessages++;
                        scanStatus.foundCount++;

                        console.log(`📜 发现消息 #${currentId}`);

                        if (!skipExisting) {
                            // 尝试克隆消息
                            try {
                                await this.cloneMessage(sourceChannelId, targetChannelId, currentId);
                                clonedMessages++;
                                scanStatus.clonedCount++;
                                console.log(`✅ 成功克隆消息 #${currentId}`);
                            } catch (cloneError) {
                                console.error(`❌ 克隆消息 #${currentId} 失败:`, cloneError.message);
                                scanStatus.errors.push(`消息 #${currentId}: ${cloneError.message}`);
                            }
                        }
                    }

                } catch (error) {
                    // 消息不存在或无权限，继续扫描
                    if (error.message.includes('message not found')) {
                        // 正常情况，消息不存在
                    } else {
                        scanStatus.errors.push(`扫描消息 #${currentId}: ${error.message}`);
                    }
                }

                currentId++;

                // 更新进度
                if (scanStatus.scannedCount % 100 === 0) {
                    console.log(`📊 扫描进度: ${scanStatus.scannedCount}/${maxId}, 找到: ${foundMessages}, 克隆: ${clonedMessages}`);
                }

                // 添加延迟避免API限制
                if (delayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            scanStatus.isRunning = false;
            scanStatus.endTime = new Date();

            const result = {
                success: true,
                configName,
                summary: {
                    scannedCount: scanStatus.scannedCount,
                    foundCount: foundMessages,
                    clonedCount: clonedMessages,
                    duration: scanStatus.endTime - scanStatus.startTime,
                    errors: scanStatus.errors
                },
                limitation: 'Bot API限制：无法直接获取历史消息，此功能为实验性质，成功率有限'
            };

            console.log(`✅ 扫描完成:`, result.summary);
            return result;

        } catch (error) {
            scanStatus.isRunning = false;
            scanStatus.error = error.message;
            
            console.error(`❌ 扫描历史消息失败:`, error);
            throw error;
        }
    }

    /**
     * 测试消息是否存在（Bot API限制方法）
     */
    async testMessageExists(channelId, messageId) {
        try {
            // 使用forwardMessage测试消息是否存在
            // 这是Bot API中检测消息存在性的标准方法
            const result = await this.bot.forwardMessage(
                channelId, // 转发到同一个频道
                channelId, // 从同一个频道
                messageId,
                { disable_notification: true }
            );

            if (result && result.message_id) {
                // 立即删除测试消息
                try {
                    await this.bot.deleteMessage(channelId, result.message_id);
                } catch (deleteError) {
                    console.warn(`⚠️ 无法删除测试消息: ${deleteError.message}`);
                }
                return true;
            }
            return false;

        } catch (error) {
            // 消息不存在或无权限
            return false;
        }
    }

    /**
     * 克隆单个消息
     */
    async cloneMessage(sourceChannelId, targetChannelId, messageId) {
        try {
            const result = await this.bot.copyMessage(
                targetChannelId,
                sourceChannelId,
                messageId,
                { disable_notification: true }
            );

            return result;
        } catch (error) {
            throw new Error(`克隆失败: ${error.message}`);
        }
    }
}

module.exports = ChannelConfigService; 