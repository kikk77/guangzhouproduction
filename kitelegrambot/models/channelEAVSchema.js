const { getChannelDatabase } = require('../config/channelDatabase');

class ChannelEAVSchema {
    constructor() {
        this.db = getChannelDatabase();
    }

    /**
     * 获取或创建实体
     * @param {string} entityType 实体类型
     * @param {string} entityName 实体名称
     * @param {number} parentId 父实体ID
     * @param {string} createdBy 创建者
     * @returns {number} 实体ID
     */
    getOrCreateEntity(entityType, entityName = null, parentId = null, createdBy = 'system') {
        try {
            // 先尝试查找现有实体
            let entity = null;
            if (entityName) {
                // 如果有实体名称，按名称和类型查找
                entity = this.db.prepare(`
                    SELECT id FROM channel_entities 
                    WHERE entity_type = ? AND entity_name = ? AND status = 'active'
                `).get(entityType, entityName);
            } else if (parentId) {
                // 如果没有名称但有父ID，按类型和父ID查找
                entity = this.db.prepare(`
                    SELECT id FROM channel_entities 
                    WHERE entity_type = ? AND parent_id = ? AND status = 'active'
                `).get(entityType, parentId);
            }

            if (entity) {
                return entity.id;
            }

            // 创建新实体
            const result = this.db.prepare(`
                INSERT INTO channel_entities (entity_type, entity_name, parent_id, created_by) 
                VALUES (?, ?, ?, ?)
            `).run(entityType, entityName, parentId, createdBy);

            return result.lastInsertRowid;
        } catch (error) {
            console.error('获取或创建实体失败:', error);
            throw error;
        }
    }

    /**
     * 获取属性ID
     * @param {string} attributeName 属性名称
     * @returns {number|null} 属性ID
     */
    getAttributeId(attributeName) {
        try {
            const result = this.db.prepare(`
                SELECT id FROM channel_attributes WHERE attribute_name = ?
            `).get(attributeName);
            return result ? result.id : null;
        } catch (error) {
            console.error('获取属性ID失败:', error);
            return null;
        }
    }

    /**
     * 获取属性信息
     * @param {string} attributeName 属性名称
     * @returns {object|null} 属性信息
     */
    getAttributeInfo(attributeName) {
        try {
            return this.db.prepare(`
                SELECT * FROM channel_attributes WHERE attribute_name = ?
            `).get(attributeName);
        } catch (error) {
            console.error('获取属性信息失败:', error);
            return null;
        }
    }

    /**
     * 设置实体属性值
     * @param {number} entityId 实体ID
     * @param {string} attributeName 属性名称
     * @param {any} value 属性值
     * @returns {boolean} 是否成功
     */
    setEntityValue(entityId, attributeName, value) {
        try {
            const attributeInfo = this.getAttributeInfo(attributeName);
            if (!attributeInfo) {
                console.error(`属性 ${attributeName} 不存在`);
                return false;
            }

            // 准备值存储
            const valueData = {
                value_string: null,
                value_integer: null,
                value_boolean: null,
                value_json: null,
                value_datetime: null,
                value_text: null
            };

            // 根据属性类型存储值
            switch (attributeInfo.attribute_type) {
                case 'string':
                    valueData.value_string = String(value);
                    break;
                case 'integer':
                    valueData.value_integer = parseInt(value);
                    break;
                case 'boolean':
                    // SQLite不支持布尔类型，转换为整数 (0/1)
                    valueData.value_boolean = Boolean(value) ? 1 : 0;
                    break;
                case 'json':
                    valueData.value_json = typeof value === 'string' ? value : JSON.stringify(value);
                    break;
                case 'datetime':
                    valueData.value_datetime = value instanceof Date ? value.toISOString() : value;
                    break;
                case 'text':
                    valueData.value_text = String(value);
                    break;
                default:
                    valueData.value_string = String(value);
            }

            // 插入或更新值
            const result = this.db.prepare(`
                INSERT OR REPLACE INTO channel_values 
                (entity_id, attribute_id, value_string, value_integer, value_boolean, value_json, value_datetime, value_text, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                entityId,
                attributeInfo.id,
                valueData.value_string,
                valueData.value_integer,
                valueData.value_boolean,
                valueData.value_json,
                valueData.value_datetime,
                valueData.value_text
            );

            return result.changes > 0;
        } catch (error) {
            console.error('设置实体属性值失败:', error);
            return false;
        }
    }

    /**
     * 获取实体属性值
     * @param {number} entityId 实体ID
     * @param {string} attributeName 属性名称
     * @returns {any} 属性值
     */
    getEntityValue(entityId, attributeName) {
        try {
            const attributeInfo = this.getAttributeInfo(attributeName);
            if (!attributeInfo) {
                return null;
            }

            const result = this.db.prepare(`
                SELECT * FROM channel_values 
                WHERE entity_id = ? AND attribute_id = ?
            `).get(entityId, attributeInfo.id);

            if (!result) {
                return attributeInfo.default_value;
            }

            // 根据属性类型返回值
            switch (attributeInfo.attribute_type) {
                case 'string':
                    return result.value_string;
                case 'integer':
                    return result.value_integer;
                case 'boolean':
                    // SQLite中布尔值存储为整数，需要转换回布尔值
                    return Boolean(result.value_boolean);
                case 'json':
                    try {
                        return result.value_json ? JSON.parse(result.value_json) : null;
                    } catch {
                        return result.value_json;
                    }
                case 'datetime':
                    return result.value_datetime;
                case 'text':
                    return result.value_text;
                default:
                    return result.value_string;
            }
        } catch (error) {
            console.error('获取实体属性值失败:', error);
            return null;
        }
    }

    /**
     * 获取实体的所有属性值
     * @param {number} entityId 实体ID
     * @returns {object} 属性值对象
     */
    getEntityAllValues(entityId) {
        try {
            const results = this.db.prepare(`
                SELECT a.attribute_name, a.attribute_type, a.default_value,
                       v.value_string, v.value_integer, v.value_boolean, 
                       v.value_json, v.value_datetime, v.value_text
                FROM channel_attributes a
                LEFT JOIN channel_values v ON a.id = v.attribute_id AND v.entity_id = ?
            `).all(entityId);

            const values = {};
            for (const row of results) {
                let value = null;
                
                if (row.value_string !== null || row.value_integer !== null || row.value_boolean !== null ||
                    row.value_json !== null || row.value_datetime !== null || row.value_text !== null) {
                    // 有存储的值
                    switch (row.attribute_type) {
                        case 'string':
                            value = row.value_string;
                            break;
                        case 'integer':
                            value = row.value_integer;
                            break;
                        case 'boolean':
                            // SQLite中布尔值存储为整数，需要转换回布尔值
                            value = Boolean(row.value_boolean);
                            break;
                        case 'json':
                            try {
                                value = row.value_json ? JSON.parse(row.value_json) : null;
                            } catch {
                                value = row.value_json;
                            }
                            break;
                        case 'datetime':
                            value = row.value_datetime;
                            break;
                        case 'text':
                            value = row.value_text;
                            break;
                        default:
                            value = row.value_string;
                    }
                } else {
                    // 使用默认值
                    value = row.default_value;
                    if (row.attribute_type === 'boolean' && value !== null) {
                        value = value === 'true';
                    } else if (row.attribute_type === 'integer' && value !== null) {
                        value = parseInt(value);
                    } else if (row.attribute_type === 'json' && value !== null) {
                        try {
                            value = JSON.parse(value);
                        } catch {
                            // 保持原值
                        }
                    }
                }

                values[row.attribute_name] = value;
            }

            return values;
        } catch (error) {
            console.error('获取实体所有属性值失败:', error);
            return {};
        }
    }

    /**
     * 创建实体关系
     * @param {number} parentEntityId 父实体ID
     * @param {number} childEntityId 子实体ID
     * @param {string} relationType 关系类型
     * @param {object} relationData 关系数据
     * @returns {boolean} 是否成功
     */
    createRelation(parentEntityId, childEntityId, relationType, relationData = null) {
        try {
            const result = this.db.prepare(`
                INSERT OR REPLACE INTO channel_relations 
                (parent_entity_id, child_entity_id, relation_type, relation_data) 
                VALUES (?, ?, ?, ?)
            `).run(
                parentEntityId,
                childEntityId,
                relationType,
                relationData ? JSON.stringify(relationData) : null
            );

            return result.changes > 0;
        } catch (error) {
            console.error('创建实体关系失败:', error);
            return false;
        }
    }

    /**
     * 获取实体关系
     * @param {number} parentEntityId 父实体ID
     * @param {string} relationType 关系类型
     * @returns {array} 关系列表
     */
    getRelations(parentEntityId, relationType = null) {
        try {
            let query = `
                SELECT r.*, 
                       e.entity_type as child_entity_type, 
                       e.entity_name as child_entity_name
                FROM channel_relations r
                JOIN channel_entities e ON r.child_entity_id = e.id
                WHERE r.parent_entity_id = ?
            `;
            
            const params = [parentEntityId];
            
            if (relationType) {
                query += ` AND r.relation_type = ?`;
                params.push(relationType);
            }

            const results = this.db.prepare(query).all(...params);

            return results.map(row => ({
                ...row,
                relation_data: row.relation_data ? JSON.parse(row.relation_data) : null
            }));
        } catch (error) {
            console.error('获取实体关系失败:', error);
            return [];
        }
    }

    /**
     * 根据类型获取实体列表
     * @param {string} entityType 实体类型
     * @param {string} status 实体状态
     * @returns {array} 实体列表
     */
    getEntitiesByType(entityType, status = 'active') {
        try {
            const results = this.db.prepare(`
                SELECT * FROM channel_entities 
                WHERE entity_type = ? AND status = ?
                ORDER BY created_at DESC
            `).all(entityType, status);

            return results;
        } catch (error) {
            console.error('根据类型获取实体失败:', error);
            return [];
        }
    }

    /**
     * 删除实体（软删除）
     * @param {number} entityId 实体ID
     * @returns {boolean} 是否成功
     */
    deleteEntity(entityId) {
        try {
            const result = this.db.prepare(`
                UPDATE channel_entities 
                SET status = 'deleted', updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(entityId);

            return result.changes > 0;
        } catch (error) {
            console.error('删除实体失败:', error);
            return false;
        }
    }

    /**
     * 搜索实体
     * @param {string} entityType 实体类型
     * @param {object} searchCriteria 搜索条件
     * @returns {array} 搜索结果
     */
    searchEntities(entityType, searchCriteria = {}) {
        try {
            let query = `
                SELECT DISTINCT e.* FROM channel_entities e
                WHERE e.entity_type = ? AND e.status = 'active'
            `;
            const params = [entityType];

            // 如果有属性搜索条件，加入JOIN
            if (Object.keys(searchCriteria).length > 0) {
                query += `
                    AND e.id IN (
                        SELECT DISTINCT v.entity_id FROM channel_values v
                        JOIN channel_attributes a ON v.attribute_id = a.id
                        WHERE (
                `;

                const conditions = [];
                for (const [attrName, value] of Object.entries(searchCriteria)) {
                    conditions.push(`(a.attribute_name = ? AND (
                        v.value_string = ? OR 
                        v.value_integer = ? OR 
                        v.value_text = ? OR
                        v.value_json LIKE ?
                    ))`);
                    params.push(attrName, String(value), parseInt(value) || 0, String(value), `%${value}%`);
                }

                query += conditions.join(' OR ') + `
                        )
                    )
                `;
            }

            query += ` ORDER BY e.created_at DESC`;

            return this.db.prepare(query).all(...params);
        } catch (error) {
            console.error('搜索实体失败:', error);
            return [];
        }
    }

    /**
     * 批量设置实体属性
     * @param {number} entityId 实体ID
     * @param {object} attributes 属性对象
     * @returns {boolean} 是否成功
     */
    setEntityAttributes(entityId, attributes) {
        try {
            const transaction = this.db.transaction(() => {
                for (const [attrName, value] of Object.entries(attributes)) {
                    this.setEntityValue(entityId, attrName, value);
                }
            });

            transaction();
            return true;
        } catch (error) {
            console.error('批量设置实体属性失败:', error);
            return false;
        }
    }

    /**
     * 获取数据库统计信息
     * @returns {object} 统计信息
     */
    getStatistics() {
        try {
            const stats = {};
            
            // 实体统计
            const entityStats = this.db.prepare(`
                SELECT entity_type, COUNT(*) as count 
                FROM channel_entities 
                WHERE status = 'active'
                GROUP BY entity_type
            `).all();
            
            stats.entities = {};
            for (const stat of entityStats) {
                stats.entities[stat.entity_type] = stat.count;
            }

            // 总体统计
            stats.total_entities = this.db.prepare(`
                SELECT COUNT(*) as count FROM channel_entities WHERE status = 'active'
            `).get().count;

            stats.total_values = this.db.prepare(`
                SELECT COUNT(*) as count FROM channel_values
            `).get().count;

            stats.total_relations = this.db.prepare(`
                SELECT COUNT(*) as count FROM channel_relations
            `).get().count;

            return stats;
        } catch (error) {
            console.error('获取统计信息失败:', error);
            return {};
        }
    }
}

module.exports = ChannelEAVSchema;
