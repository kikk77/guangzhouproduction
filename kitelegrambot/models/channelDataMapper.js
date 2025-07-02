const ChannelEAVOperations = require('./channelEAVOperations');

/**
 * 频道数据映射层 - 将EAV数据转换为易用的业务对象
 */
class ChannelDataMapper {
    constructor() {
        this.eavOps = new ChannelEAVOperations();
    }

    /**
     * 频道配置业务对象
     */
    createChannelConfigObject(configData) {
        const config = {
            // 基础信息
            id: configData.id || null,
            name: configData.config_name || '',
            
            // 频道信息
            sourceChannel: {
                id: configData.source_channel_id || '',
                name: '', // 将通过API获取
                username: ''
            },
            
            targetChannel: {
                id: configData.target_channel_id || '',
                name: '', // 将通过API获取
                username: ''
            },
            
            // 克隆设置
            settings: {
                enabled: Boolean(configData.clone_enabled),
                syncEdits: configData.sync_edits !== false,
                filterEnabled: configData.filter_enabled === true,
                rateLimit: configData.rate_limit || 30,
                delaySeconds: configData.delay_seconds || 0,
                sequentialMode: Boolean(configData.sequential_mode),
                rules: configData.clone_rules || {},
                
                // 🆕 新增：消息过滤功能（借鉴Telegram_Forwarder）
                messageFilters: {
                    // 关键词过滤：包含这些词的消息会被转发
                    keywords: configData.filter_keywords ? JSON.parse(configData.filter_keywords) : [],
                    // 黑名单：包含这些词的消息不会被转发
                    blacklist: configData.filter_blacklist ? JSON.parse(configData.filter_blacklist) : [],
                    // 是否移除转发标签
                    removeForwardTag: Boolean(configData.remove_forward_tag),
                    // 消息类型过滤
                    allowedTypes: configData.allowed_message_types ? JSON.parse(configData.allowed_message_types) : ['text', 'photo', 'video', 'document', 'audio'],
                    // 最小消息长度
                    minLength: configData.min_message_length || 0,
                    // 最大消息长度
                    maxLength: configData.max_message_length || 0,
                    // 是否转发媒体组
                    forwardMediaGroups: configData.forward_media_groups !== false
                }
            },
            
            // 时间信息
            createdAt: configData.created_at,
            updatedAt: configData.updated_at,
            status: configData.status || 'active'
        };

        return config;
    }

    /**
     * 获取所有频道配置（业务对象格式）
     */
    async getAllChannelConfigs() {
        try {
            const rawConfigs = this.eavOps.getAllChannelConfigs();
            return rawConfigs.map(config => this.createChannelConfigObject(config));
        } catch (error) {
            console.error('获取频道配置失败:', error);
            return [];
        }
    }

    /**
     * 获取单个频道配置（业务对象格式）
     */
    async getChannelConfig(configName) {
        try {
            const rawConfig = this.eavOps.getChannelConfig(configName);
            return rawConfig ? this.createChannelConfigObject(rawConfig) : null;
        } catch (error) {
            console.error('获取频道配置失败:', error);
            return null;
        }
    }

    /**
     * 获取启用的频道配置列表
     */
    async getEnabledChannelConfigs() {
        try {
            const allConfigs = await this.getAllChannelConfigs();
            return allConfigs.filter(config => config.settings.enabled && config.status === 'active');
        } catch (error) {
            console.error('获取启用的频道配置失败:', error);
            return [];
        }
    }

    /**
     * 根据源频道ID获取配置
     */
    async getConfigBySourceChannel(sourceChannelId) {
        try {
            const allConfigs = await this.getEnabledChannelConfigs();
            return allConfigs.find(config => config.sourceChannel.id === sourceChannelId) || null;
        } catch (error) {
            console.error('根据源频道ID获取配置失败:', error);
            return null;
        }
    }

    /**
     * 创建或更新频道配置
     */
    async saveChannelConfig(configData) {
        try {
            const {
                name,
                sourceChannelId,
                targetChannelId,
                enabled = true,
                syncEdits = true,
                filterEnabled = false,
                rateLimit = 30,
                delaySeconds = 0,
                sequentialMode = false,
                rules = {}
            } = configData;

            console.log('📺 保存配置数据:', {
                name,
                sourceChannelId,
                targetChannelId,
                enabled,
                syncEdits,
                filterEnabled,
                rateLimit,
                delaySeconds,
                sequentialMode,
                rules
            });

            // 检查是否存在
            const existing = this.eavOps.getChannelConfig(name);
            
            if (existing) {
                // 更新现有配置
                const success = this.eavOps.updateChannelConfig(name, {
                    source_channel_id: sourceChannelId,
                    target_channel_id: targetChannelId,
                    clone_enabled: enabled,
                    sync_edits: syncEdits,
                    filter_enabled: filterEnabled,
                    rate_limit: rateLimit,
                    delay_seconds: delaySeconds,
                    sequential_mode: sequentialMode,
                    clone_rules: rules
                });
                
                console.log('📺 更新配置结果:', success);
                return success ? await this.getChannelConfig(name) : null;
            } else {
                // 创建新配置
                const entityId = this.eavOps.createChannelConfig({
                    configName: name,
                    sourceChannelId,
                    targetChannelId,
                    cloneEnabled: enabled,
                    syncEdits,
                    filterEnabled,
                    rateLimit,
                    delaySeconds,
                    sequentialMode,
                    cloneRules: rules
                });
                
                console.log('📺 创建配置结果:', entityId);
                return entityId ? await this.getChannelConfig(name) : null;
            }
        } catch (error) {
            console.error('保存频道配置失败:', error);
            return null;
        }
    }

    /**
     * 删除频道配置
     */
    async deleteChannelConfig(configName) {
        try {
            return this.eavOps.deleteChannelConfig(configName);
        } catch (error) {
            console.error('删除频道配置失败:', error);
            return false;
        }
    }

    /**
     * 消息映射业务对象
     */
    createMessageMappingObject(mappingData) {
        return {
            id: mappingData.id || null,
            configId: mappingData.config_id,
            sourceMessageId: mappingData.source_message_id,
            targetMessageId: mappingData.target_message_id,
            messageType: mappingData.message_type || 'unknown',
            status: mappingData.clone_status || 'success',
            cloneTime: mappingData.clone_time,
            contentHash: mappingData.message_content_hash,
            createdAt: mappingData.created_at
        };
    }

    /**
     * 创建消息映射
     */
    async createMessageMapping(configId, sourceMessageId, targetMessageId, messageType = 'unknown') {
        try {
            const entityId = this.eavOps.createMessageMapping({
                configId,
                sourceMessageId,
                targetMessageId,
                messageType,
                cloneStatus: 'success'
            });

            return entityId !== null;
        } catch (error) {
            console.error('创建消息映射失败:', error);
            return false;
        }
    }

    /**
     * 获取消息映射
     */
    async getMessageMapping(sourceMessageId, configId = null) {
        try {
            const rawMapping = this.eavOps.getMessageMapping(sourceMessageId, configId);
            return rawMapping ? this.createMessageMappingObject(rawMapping) : null;
        } catch (error) {
            console.error('获取消息映射失败:', error);
            return null;
        }
    }

    /**
     * 克隆队列任务业务对象
     */
    createQueueTaskObject(taskData) {
        return {
            id: taskData.id,
            configId: taskData.config_id,
            priority: taskData.priority || 1,
            scheduledTime: taskData.scheduled_time,
            retryCount: taskData.retry_count || 0,
            maxRetries: taskData.max_retries || 3,
            type: taskData.queue_type || 'normal',
            data: taskData.queue_data || {},
            createdAt: taskData.created_at,
            
            // 计算属性
            isReady: new Date(taskData.scheduled_time) <= new Date(),
            canRetry: (taskData.retry_count || 0) < (taskData.max_retries || 3)
        };
    }

    /**
     * 添加克隆任务
     */
    async addCloneTask(configId, taskData = {}) {
        try {
            const {
                priority = 1,
                scheduledTime = null,
                type = 'normal',
                data = {},
                maxRetries = 3
            } = taskData;

            const entityId = this.eavOps.addToCloneQueue({
                configId,
                priority,
                scheduledTime,
                queueType: type,
                queueData: data,
                maxRetries
            });

            return entityId !== null;
        } catch (error) {
            console.error('添加克隆任务失败:', error);
            return false;
        }
    }

    /**
     * 获取待处理的克隆任务
     */
    async getPendingCloneTasks(limit = 10) {
        try {
            const rawTasks = this.eavOps.getPendingQueueTasks(limit);
            return rawTasks.map(task => this.createQueueTaskObject(task));
        } catch (error) {
            console.error('获取待处理克隆任务失败:', error);
            return [];
        }
    }

    /**
     * 更新任务状态
     */
    async updateTaskStatus(taskId, updateData) {
        try {
            return this.eavOps.updateQueueTask(taskId, updateData);
        } catch (error) {
            console.error('更新任务状态失败:', error);
            return false;
        }
    }

    /**
     * 完成任务
     */
    async completeTask(taskId) {
        try {
            return this.eavOps.completeQueueTask(taskId);
        } catch (error) {
            console.error('完成任务失败:', error);
            return false;
        }
    }

    /**
     * 增加任务重试次数
     */
    async retryTask(taskId, errorMessage = null) {
        try {
            // 获取当前任务信息来增加重试次数
            const currentRetryCount = await this.getCurrentRetryCount(taskId);
            const nextScheduledTime = new Date();
            nextScheduledTime.setMinutes(nextScheduledTime.getMinutes() + Math.pow(2, currentRetryCount)); // 指数退避
            
            return this.eavOps.updateQueueTask(taskId, {
                retry_count: currentRetryCount + 1,
                scheduled_time: nextScheduledTime.toISOString(),
                log_data: { last_error: errorMessage, retry_at: nextScheduledTime.toISOString() }
            });
        } catch (error) {
            console.error('重试任务失败:', error);
            return false;
        }
    }

    /**
     * 获取当前重试次数（辅助方法）
     */
    async getCurrentRetryCount(taskId) {
        try {
            // 这里需要直接查询EAV来获取当前重试次数
            const currentRetry = this.eavOps.schema.getEntityValue(taskId, 'retry_count');
            return currentRetry || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * 日志业务对象
     */
    createLogObject(logData) {
        return {
            id: logData.id,
            configId: logData.config_id,
            action: logData.action,
            status: logData.status,
            errorMessage: logData.error_message,
            processingTime: logData.processing_time || 0,
            data: logData.log_data || {},
            createdAt: logData.created_at,
            
            // 计算属性
            isSuccess: logData.status === 'success',
            isError: logData.status === 'error',
            duration: logData.processing_time ? `${logData.processing_time}ms` : 'N/A'
        };
    }

    /**
     * 记录操作日志
     */
    async logAction(configId, action, status = 'success', errorMessage = null, processingTime = 0, data = {}) {
        try {
            const entityId = this.eavOps.logCloneAction({
                configId,
                action,
                status,
                errorMessage,
                processingTime,
                data
            });

            return entityId !== null;
        } catch (error) {
            console.error('记录操作日志失败:', error);
            return false;
        }
    }

    /**
     * 获取操作日志
     */
    async getLogs(configId = null, limit = 50) {
        try {
            const rawLogs = this.eavOps.getCloneLogs(configId, limit);
            return rawLogs.map(log => this.createLogObject(log));
        } catch (error) {
            console.error('获取操作日志失败:', error);
            return [];
        }
    }

    /**
     * 获取系统统计信息
     */
    async getSystemStats() {
        try {
            const rawStats = this.eavOps.getSystemOverview();
            
            return {
                database: {
                    totalEntities: rawStats.total_entities || 0,
                    totalValues: rawStats.total_values || 0,
                    totalRelations: rawStats.total_relations || 0
                },
                entities: rawStats.entities || {},
                recentActivity: rawStats.recent_activity || {
                    total_actions: 0,
                    success_count: 0,
                    error_count: 0,
                    success_rate: 0
                },
                configs: {
                    total: rawStats.entities?.channel_config || 0,
                    active: 0 // 需要单独计算
                }
            };
        } catch (error) {
            console.error('获取系统统计失败:', error);
            return {
                database: { totalEntities: 0, totalValues: 0, totalRelations: 0 },
                entities: {},
                recentActivity: { total_actions: 0, success_count: 0, error_count: 0, success_rate: 0 },
                configs: { total: 0, active: 0 }
            };
        }
    }

    /**
     * 更新统计数据
     */
    async updateStats(statType, value, period = 'daily', data = {}) {
        try {
            return this.eavOps.updateStatistics(statType, value, period, data);
        } catch (error) {
            console.error('更新统计数据失败:', error);
            return false;
        }
    }

    /**
     * 数据清理
     */
    async cleanupOldData(daysBefore = 30) {
        try {
            return this.eavOps.cleanupOldData(daysBefore);
        } catch (error) {
            console.error('数据清理失败:', error);
            return { logs: 0, queue_tasks: 0, mappings: 0 };
        }
    }

    /**
     * 验证频道ID格式
     */
    validateChannelId(channelId) {
        if (!channelId) return { valid: false, error: '频道ID不能为空' };
        
        // Telegram频道ID通常以-100开头
        if (!channelId.toString().startsWith('-100')) {
            return { valid: false, error: '频道ID格式错误，应以-100开头' };
        }
        
        return { valid: true };
    }

    /**
     * 验证配置数据
     */
    validateConfigData(configData) {
        const errors = [];
        
        if (!configData.name || configData.name.trim().length === 0) {
            errors.push('配置名称不能为空');
        }
        
        const sourceValidation = this.validateChannelId(configData.sourceChannelId);
        if (!sourceValidation.valid) {
            errors.push(`源频道${sourceValidation.error}`);
        }
        
        const targetValidation = this.validateChannelId(configData.targetChannelId);
        if (!targetValidation.valid) {
            errors.push(`目标频道${targetValidation.error}`);
        }
        
        if (configData.sourceChannelId === configData.targetChannelId) {
            errors.push('源频道和目标频道不能相同');
        }
        
        if (configData.rateLimit && (configData.rateLimit < 1 || configData.rateLimit > 1000)) {
            errors.push('速率限制必须在1-1000之间');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 获取配置的运行状态
     */
    async getConfigStatus(configName) {
        try {
            const config = await this.getChannelConfig(configName);
            if (!config) {
                return { status: 'not_found', message: '配置不存在' };
            }
            
            if (!config.settings.enabled) {
                return { status: 'disabled', message: '配置已禁用' };
            }
            
            if (config.status !== 'active') {
                return { status: 'inactive', message: '配置不活跃' };
            }
            
            // 检查最近的日志
            const recentLogs = await this.getLogs(config.id, 5);
            const hasRecentErrors = recentLogs.some(log => log.isError);
            
            if (hasRecentErrors) {
                return { status: 'error', message: '最近有错误日志' };
            }
            
            return { status: 'running', message: '正常运行中' };
        } catch (error) {
            console.error('获取配置状态失败:', error);
            return { status: 'error', message: '获取状态失败' };
        }
    }
}

module.exports = ChannelDataMapper;
