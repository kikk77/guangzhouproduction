const ChannelEAVSchema = require('./channelEAVSchema');

class ChannelEAVOperations {
    constructor() {
        this.schema = new ChannelEAVSchema();
    }

    /**
     * 创建频道配置
     * @param {object} configData 配置数据
     * @returns {number|null} 配置实体ID
     */
    createChannelConfig(configData) {
        try {
            const {
                configName,
                sourceChannelId,
                targetChannelId,
                cloneEnabled = true,
                syncEdits = true,
                filterEnabled = false,
                rateLimit = 30,
                delaySeconds = 0,
                sequentialMode = false,
                cloneRules = {}
            } = configData;

            // 检查是否已存在同名配置
            const existingConfigs = this.schema.searchEntities('channel_config', { config_name: configName });
            if (existingConfigs.length > 0) {
                console.error(`频道配置 ${configName} 已存在`);
                return null;
            }

            // 创建配置实体
            const entityId = this.schema.getOrCreateEntity('channel_config', configName);
            if (!entityId) {
                return null;
            }

            // 设置配置属性
            const success = this.schema.setEntityAttributes(entityId, {
                config_name: configName,
                source_channel_id: sourceChannelId,
                target_channel_id: targetChannelId,
                clone_enabled: cloneEnabled,
                sync_edits: syncEdits,
                filter_enabled: filterEnabled,
                rate_limit: rateLimit,
                delay_seconds: delaySeconds,
                sequential_mode: sequentialMode,
                clone_rules: cloneRules
            });

            return success ? entityId : null;
        } catch (error) {
            console.error('创建频道配置失败:', error);
            return null;
        }
    }

    /**
     * 获取频道配置
     * @param {string} configName 配置名称
     * @returns {object|null} 配置对象
     */
    getChannelConfig(configName) {
        try {
            const entities = this.schema.searchEntities('channel_config', { config_name: configName });
            if (entities.length === 0) {
                return null;
            }

            const entity = entities[0];
            
            // 检查配置是否已删除
            if (entity.status === 'deleted') {
                return null;
            }
            
            const values = this.schema.getEntityAllValues(entity.id);

            return {
                id: entity.id,
                entity_id: entity.id,
                config_name: values.config_name,
                source_channel_id: values.source_channel_id,
                target_channel_id: values.target_channel_id,
                clone_enabled: values.clone_enabled,
                sync_edits: values.sync_edits,
                filter_enabled: values.filter_enabled,
                rate_limit: values.rate_limit,
                delay_seconds: values.delay_seconds || 0,
                sequential_mode: values.sequential_mode || false,
                clone_rules: values.clone_rules || {},
                created_at: entity.created_at,
                updated_at: entity.updated_at
            };
        } catch (error) {
            console.error('获取频道配置失败:', error);
            return null;
        }
    }

    /**
     * 获取所有频道配置
     * @returns {array} 配置列表
     */
    getAllChannelConfigs() {
        try {
            const entities = this.schema.getEntitiesByType('channel_config');
            const configs = [];

            for (const entity of entities) {
                // 过滤掉已删除的配置
                if (entity.status === 'deleted') {
                    continue;
                }
                
                const values = this.schema.getEntityAllValues(entity.id);
                configs.push({
                    id: entity.id,
                    entity_id: entity.id,
                    config_name: values.config_name,
                    source_channel_id: values.source_channel_id,
                    target_channel_id: values.target_channel_id,
                    clone_enabled: values.clone_enabled,
                    sync_edits: values.sync_edits,
                    filter_enabled: values.filter_enabled,
                    rate_limit: values.rate_limit,
                    delay_seconds: values.delay_seconds || 0,
                    sequential_mode: values.sequential_mode || false,
                    clone_rules: values.clone_rules || {},
                    created_at: entity.created_at,
                    updated_at: entity.updated_at,
                    status: entity.status
                });
            }

            return configs;
        } catch (error) {
            console.error('获取所有频道配置失败:', error);
            return [];
        }
    }

    /**
     * 更新频道配置
     * @param {string} configName 配置名称
     * @param {object} updateData 更新数据
     * @returns {boolean} 是否成功
     */
    updateChannelConfig(configName, updateData) {
        try {
            const config = this.getChannelConfig(configName);
            if (!config) {
                return false;
            }

            return this.schema.setEntityAttributes(config.entity_id, updateData);
        } catch (error) {
            console.error('更新频道配置失败:', error);
            return false;
        }
    }

    /**
     * 删除频道配置
     * @param {string} configName 配置名称
     * @returns {boolean} 是否成功
     */
    deleteChannelConfig(configName) {
        try {
            const config = this.getChannelConfig(configName);
            if (!config) {
                return false;
            }

            return this.schema.deleteEntity(config.entity_id);
        } catch (error) {
            console.error('删除频道配置失败:', error);
            return false;
        }
    }

    /**
     * 创建消息映射
     * @param {object} mappingData 映射数据
     * @returns {number|null} 映射实体ID
     */
    createMessageMapping(mappingData) {
        try {
            const {
                configId,
                sourceMessageId,
                targetMessageId,
                messageType = 'unknown',
                cloneStatus = 'success',
                messageContentHash = null
            } = mappingData;

            // 创建映射实体
            const entityId = this.schema.getOrCreateEntity('message_mapping', null, configId);
            if (!entityId) {
                return null;
            }

            // 设置映射属性
            const success = this.schema.setEntityAttributes(entityId, {
                source_message_id: sourceMessageId,
                target_message_id: targetMessageId,
                message_type: messageType,
                clone_status: cloneStatus,
                clone_time: new Date().toISOString(),
                message_content_hash: messageContentHash
            });

            // 创建与配置的关系
            if (configId && success) {
                this.schema.createRelation(configId, entityId, 'config_to_mapping');
            }

            return success ? entityId : null;
        } catch (error) {
            console.error('创建消息映射失败:', error);
            return null;
        }
    }

    /**
     * 获取消息映射
     * @param {number} sourceMessageId 源消息ID
     * @param {number} configId 配置ID
     * @returns {object|null} 映射对象
     */
    getMessageMapping(sourceMessageId, configId = null) {
        try {
            let searchCriteria = { source_message_id: sourceMessageId };
            
            const entities = this.schema.searchEntities('message_mapping', searchCriteria);
            
            // 如果指定了配置ID，进一步过滤
            if (configId && entities.length > 0) {
                for (const entity of entities) {
                    if (entity.parent_id === configId) {
                        const values = this.schema.getEntityAllValues(entity.id);
                        return {
                            id: entity.id,
                            entity_id: entity.id,
                            config_id: configId,
                            source_message_id: values.source_message_id,
                            target_message_id: values.target_message_id,
                            message_type: values.message_type,
                            clone_status: values.clone_status,
                            clone_time: values.clone_time,
                            message_content_hash: values.message_content_hash,
                            created_at: entity.created_at
                        };
                    }
                }
                return null;
            }
            
            if (entities.length === 0) {
                return null;
            }

            const entity = entities[0];
            const values = this.schema.getEntityAllValues(entity.id);

            return {
                id: entity.id,
                entity_id: entity.id,
                config_id: entity.parent_id,
                source_message_id: values.source_message_id,
                target_message_id: values.target_message_id,
                message_type: values.message_type,
                clone_status: values.clone_status,
                clone_time: values.clone_time,
                message_content_hash: values.message_content_hash,
                created_at: entity.created_at
            };
        } catch (error) {
            console.error('获取消息映射失败:', error);
            return null;
        }
    }

    /**
     * 添加任务到克隆队列
     * @param {object} queueData 队列数据
     * @returns {number|null} 队列实体ID
     */
    addToCloneQueue(queueData) {
        try {
            const {
                configId,
                priority = 1,
                scheduledTime = null,
                queueType = 'normal',
                queueData: data = {},
                maxRetries = 3
            } = queueData;

            // 创建队列实体
            const entityId = this.schema.getOrCreateEntity('clone_queue', null, configId);
            if (!entityId) {
                return null;
            }

            // 设置队列属性
            const success = this.schema.setEntityAttributes(entityId, {
                priority: priority,
                scheduled_time: scheduledTime || new Date().toISOString(),
                retry_count: 0,
                queue_type: queueType,
                queue_data: data,
                max_retries: maxRetries
            });

            // 创建与配置的关系
            if (configId && success) {
                this.schema.createRelation(configId, entityId, 'config_to_queue');
            }

            return success ? entityId : null;
        } catch (error) {
            console.error('添加任务到克隆队列失败:', error);
            return null;
        }
    }

    /**
     * 获取待处理的队列任务
     * @param {number} limit 限制数量
     * @returns {array} 任务列表
     */
    getPendingQueueTasks(limit = 10) {
        try {
            const entities = this.schema.getEntitiesByType('clone_queue');
            const tasks = [];

            for (const entity of entities.slice(0, limit)) {
                const values = this.schema.getEntityAllValues(entity.id);
                
                // 检查是否应该处理（时间到了且重试次数未超限）
                const scheduledTime = new Date(values.scheduled_time);
                const now = new Date();
                
                if (scheduledTime <= now && values.retry_count < values.max_retries) {
                    tasks.push({
                        id: entity.id,
                        entity_id: entity.id,
                        config_id: entity.parent_id,
                        priority: values.priority,
                        scheduled_time: values.scheduled_time,
                        retry_count: values.retry_count,
                        queue_type: values.queue_type,
                        queue_data: values.queue_data || {},
                        max_retries: values.max_retries,
                        created_at: entity.created_at
                    });
                }
            }

            // 按优先级排序
            tasks.sort((a, b) => (b.priority || 1) - (a.priority || 1));

            return tasks;
        } catch (error) {
            console.error('获取待处理队列任务失败:', error);
            return [];
        }
    }

    /**
     * 更新队列任务状态
     * @param {number} taskId 任务ID
     * @param {object} updateData 更新数据
     * @returns {boolean} 是否成功
     */
    updateQueueTask(taskId, updateData) {
        try {
            return this.schema.setEntityAttributes(taskId, updateData);
        } catch (error) {
            console.error('更新队列任务状态失败:', error);
            return false;
        }
    }

    /**
     * 完成队列任务（删除）
     * @param {number} taskId 任务ID
     * @returns {boolean} 是否成功
     */
    completeQueueTask(taskId) {
        try {
            return this.schema.deleteEntity(taskId);
        } catch (error) {
            console.error('完成队列任务失败:', error);
            return false;
        }
    }

    /**
     * 记录克隆日志
     * @param {object} logData 日志数据
     * @returns {number|null} 日志实体ID
     */
    logCloneAction(logData) {
        try {
            const {
                configId,
                action,
                status = 'success',
                errorMessage = null,
                processingTime = 0,
                data = {}
            } = logData;

            // 创建日志实体
            const entityId = this.schema.getOrCreateEntity('clone_log', null, configId);
            if (!entityId) {
                return null;
            }

            // 设置日志属性
            const success = this.schema.setEntityAttributes(entityId, {
                action: action,
                log_status: status,
                error_message: errorMessage,
                processing_time: processingTime,
                log_data: data
            });

            // 创建与配置的关系
            if (configId && success) {
                this.schema.createRelation(configId, entityId, 'config_to_log');
            }

            return success ? entityId : null;
        } catch (error) {
            console.error('记录克隆日志失败:', error);
            return null;
        }
    }

    /**
     * 获取克隆日志
     * @param {number} configId 配置ID
     * @param {number} limit 限制数量
     * @returns {array} 日志列表
     */
    getCloneLogs(configId = null, limit = 50) {
        try {
            let entities;
            
            if (configId) {
                // 获取特定配置的日志
                const relations = this.schema.getRelations(configId, 'config_to_log');
                entities = relations.map(rel => ({
                    id: rel.child_entity_id,
                    created_at: rel.created_at
                }));
            } else {
                // 获取所有日志
                entities = this.schema.getEntitiesByType('clone_log');
            }

            const logs = [];
            const limitedEntities = entities.slice(0, limit);

            for (const entity of limitedEntities) {
                const values = this.schema.getEntityAllValues(entity.id);
                logs.push({
                    id: entity.id,
                    entity_id: entity.id,
                    config_id: configId,
                    action: values.action,
                    status: values.log_status,
                    error_message: values.error_message,
                    processing_time: values.processing_time,
                    log_data: values.log_data || {},
                    created_at: entity.created_at
                });
            }

            return logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (error) {
            console.error('获取克隆日志失败:', error);
            return [];
        }
    }

    /**
     * 更新统计数据
     * @param {string} statType 统计类型
     * @param {number} value 统计值
     * @param {string} period 统计周期
     * @param {object} data 额外数据
     * @returns {boolean} 是否成功
     */
    updateStatistics(statType, value, period = 'daily', data = {}) {
        try {
            // 查找现有统计记录
            const entities = this.schema.searchEntities('statistics', { 
                stat_type: statType, 
                stat_period: period 
            });

            let entityId;
            if (entities.length > 0) {
                entityId = entities[0].id;
            } else {
                // 创建新的统计实体
                entityId = this.schema.getOrCreateEntity('statistics', `${statType}_${period}`);
            }

            if (!entityId) {
                return false;
            }

            // 更新统计属性
            return this.schema.setEntityAttributes(entityId, {
                stat_type: statType,
                stat_value: value,
                stat_period: period,
                stat_data: data
            });
        } catch (error) {
            console.error('更新统计数据失败:', error);
            return false;
        }
    }

    /**
     * 获取统计数据
     * @param {string} statType 统计类型
     * @param {string} period 统计周期
     * @returns {object|null} 统计数据
     */
    getStatistics(statType = null, period = null) {
        try {
            let searchCriteria = {};
            if (statType) searchCriteria.stat_type = statType;
            if (period) searchCriteria.stat_period = period;

            const entities = this.schema.searchEntities('statistics', searchCriteria);
            const stats = [];

            for (const entity of entities) {
                const values = this.schema.getEntityAllValues(entity.id);
                stats.push({
                    id: entity.id,
                    stat_type: values.stat_type,
                    stat_value: values.stat_value,
                    stat_period: values.stat_period,
                    stat_data: values.stat_data || {},
                    updated_at: entity.updated_at
                });
            }

            return statType && period ? (stats[0] || null) : stats;
        } catch (error) {
            console.error('获取统计数据失败:', error);
            return null;
        }
    }

    /**
     * 清理过期数据
     * @param {number} daysBefore 保留多少天前的数据
     * @returns {object} 清理结果
     */
    cleanupOldData(daysBefore = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysBefore);
            const cutoffTimestamp = cutoffDate.toISOString();

            let deletedCounts = {
                logs: 0,
                queue_tasks: 0,
                mappings: 0
            };

            // 清理旧日志
            const oldLogs = this.schema.getEntitiesByType('clone_log');
            for (const log of oldLogs) {
                if (log.created_at < cutoffTimestamp) {
                    if (this.schema.deleteEntity(log.id)) {
                        deletedCounts.logs++;
                    }
                }
            }

            // 清理旧队列任务（失败的）
            const oldTasks = this.schema.getEntitiesByType('clone_queue');
            for (const task of oldTasks) {
                const values = this.schema.getEntityAllValues(task.id);
                if (task.created_at < cutoffTimestamp && values.retry_count >= values.max_retries) {
                    if (this.schema.deleteEntity(task.id)) {
                        deletedCounts.queue_tasks++;
                    }
                }
            }

            console.log(`数据清理完成: 日志 ${deletedCounts.logs} 条, 队列任务 ${deletedCounts.queue_tasks} 条`);
            return deletedCounts;

        } catch (error) {
            console.error('清理过期数据失败:', error);
            return { logs: 0, queue_tasks: 0, mappings: 0 };
        }
    }

    /**
     * 获取系统概览统计
     * @returns {object} 概览数据
     */
    getSystemOverview() {
        try {
            const overview = this.schema.getStatistics();
            
            // 添加最近活动统计
            const recentLogs = this.getCloneLogs(null, 10);
            const successCount = recentLogs.filter(log => log.status === 'success').length;
            const errorCount = recentLogs.filter(log => log.status === 'error').length;

            overview.recent_activity = {
                total_actions: recentLogs.length,
                success_count: successCount,
                error_count: errorCount,
                success_rate: recentLogs.length > 0 ? (successCount / recentLogs.length * 100).toFixed(2) : 0
            };

            return overview;
        } catch (error) {
            console.error('获取系统概览失败:', error);
            return {};
        }
    }
}

module.exports = ChannelEAVOperations;
