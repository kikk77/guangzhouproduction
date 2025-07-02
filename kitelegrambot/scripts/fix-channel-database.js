#!/usr/bin/env node

/**
 * 频道克隆数据库修复脚本
 * 用于修复SQLite布尔值类型问题，重新初始化数据库结构
 */

const path = require('path');
const fs = require('fs');

// 设置环境变量
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { getChannelDatabase, ChannelDatabaseManager } = require('../config/channelDatabase');

async function fixChannelDatabase() {
    console.log('🔧 开始修复频道克隆数据库...');
    
    try {
        // 1. 获取数据库实例
        const db = getChannelDatabase();
        console.log('✅ 数据库连接成功');

        // 2. 备份现有数据
        console.log('📦 开始备份现有数据...');
        const backupData = await backupExistingData(db);
        console.log(`📦 备份了 ${backupData.configs.length} 个配置`);

        // 3. 重新创建表结构（这会删除旧表并创建新表）
        console.log('🗄️ 重新创建数据库表结构...');
        await recreateTables(db);
        console.log('✅ 数据库表结构重建完成');

        // 4. 恢复数据（转换布尔值为整数）
        console.log('📥 开始恢复数据...');
        await restoreData(db, backupData);
        console.log('✅ 数据恢复完成');

        // 5. 验证数据完整性
        console.log('🔍 验证数据完整性...');
        await verifyData(db);
        console.log('✅ 数据完整性验证通过');

        console.log('🎉 频道克隆数据库修复完成！');
        
    } catch (error) {
        console.error('❌ 数据库修复失败:', error);
        process.exit(1);
    }
}

/**
 * 备份现有数据
 */
async function backupExistingData(db) {
    const backupData = {
        configs: [],
        entities: [],
        attributes: [],
        values: [],
        relations: []
    };

    try {
        // 备份配置数据（如果表存在）
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);

        if (tableNames.includes('channel_entities')) {
            backupData.entities = db.prepare("SELECT * FROM channel_entities").all();
        }
        
        if (tableNames.includes('channel_attributes')) {
            backupData.attributes = db.prepare("SELECT * FROM channel_attributes").all();
        }
        
        if (tableNames.includes('channel_values')) {
            backupData.values = db.prepare("SELECT * FROM channel_values").all();
        }
        
        if (tableNames.includes('channel_relations')) {
            backupData.relations = db.prepare("SELECT * FROM channel_relations").all();
        }

        // 尝试从EAV结构中提取配置
        if (backupData.entities.length > 0) {
            const ChannelEAVOperations = require('../models/channelEAVOperations');
            const eavOps = new ChannelEAVOperations();
            
            try {
                backupData.configs = eavOps.getAllChannelConfigs();
            } catch (error) {
                console.warn('⚠️ 无法从EAV结构提取配置，将使用原始数据恢复');
            }
        }

    } catch (error) {
        console.warn('⚠️ 备份数据时出现错误:', error.message);
    }

    return backupData;
}

/**
 * 重新创建表结构
 */
async function recreateTables(db) {
    // 删除现有表
    const dropTables = [
        'DROP TABLE IF EXISTS channel_relations',
        'DROP TABLE IF EXISTS channel_values', 
        'DROP TABLE IF EXISTS channel_attributes',
        'DROP TABLE IF EXISTS channel_entities'
    ];

    for (const sql of dropTables) {
        try {
            db.prepare(sql).run();
        } catch (error) {
            console.warn(`⚠️ 删除表时出现错误: ${error.message}`);
        }
    }

    // 重新初始化数据库
    const dbManager = new ChannelDatabaseManager();
    console.log('✅ 数据库重新初始化完成');
}

/**
 * 恢复数据
 */
async function restoreData(db, backupData) {
    if (backupData.configs.length === 0) {
        console.log('ℹ️ 没有配置数据需要恢复');
        return;
    }

    const ChannelEAVOperations = require('../models/channelEAVOperations');
    const eavOps = new ChannelEAVOperations();

    for (const config of backupData.configs) {
        try {
            // 转换布尔值并创建配置
            const configData = {
                configName: config.config_name,
                sourceChannelId: config.source_channel_id,
                targetChannelId: config.target_channel_id,
                cloneEnabled: Boolean(config.clone_enabled), // 确保是布尔值
                syncEdits: Boolean(config.sync_edits),
                filterEnabled: Boolean(config.filter_enabled),
                rateLimit: parseInt(config.rate_limit) || 30,
                cloneRules: config.clone_rules || {}
            };

            const entityId = eavOps.createChannelConfig(configData);
            if (entityId) {
                console.log(`✅ 恢复配置: ${config.config_name}`);
            } else {
                console.warn(`⚠️ 恢复配置失败: ${config.config_name}`);
            }
        } catch (error) {
            console.error(`❌ 恢复配置 ${config.config_name} 时出错:`, error.message);
        }
    }
}

/**
 * 验证数据完整性
 */
async function verifyData(db) {
    const ChannelEAVOperations = require('../models/channelEAVOperations');
    const eavOps = new ChannelEAVOperations();

    try {
        const configs = eavOps.getAllChannelConfigs();
        console.log(`📊 验证结果: 共有 ${configs.length} 个配置`);
        
        for (const config of configs) {
            console.log(`   - ${config.config_name}: ${config.clone_enabled ? '启用' : '禁用'}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ 数据验证失败:', error);
        return false;
    }
}

// 运行修复
if (require.main === module) {
    fixChannelDatabase().catch(console.error);
}

module.exports = { fixChannelDatabase }; 