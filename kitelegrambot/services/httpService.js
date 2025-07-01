const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const crypto = require('crypto');
const dbOperations = require('../models/dbOperations');
// 延迟加载botService避免循环依赖
let botService = null;
function getBotService() {
    if (!botService) {
        try {
            botService = require('./botService');
        } catch (error) {
            console.warn('BotService暂不可用:', error.message);
            return null;
        }
    }
    return botService;
}

// 安全的缓存重载函数
async function safeLoadCacheData() {
    try {
        const bs = getBotService();
        if (bs && bs.loadCacheData) {
            await bs.loadCacheData();
        } else {
            console.log('跳过缓存重载 - BotService未就绪');
        }
    } catch (error) {
        console.warn('缓存重载失败:', error.message);
    }
}
const zlib = require('zlib'); // 添加压缩支持

const PORT = process.env.PORT || 3000;

// 响应压缩配置
const COMPRESSION_THRESHOLD = 1024; // 1KB以上才压缩
const CACHE_MAX_AGE = 300; // 5分钟缓存

// HTTP请求处理函数
function handleHttpRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 处理具体的路由
    handleRoutes(req, res, pathname, method);
}

// 路由处理函数
function handleRoutes(req, res, pathname, method) {
    // favicon.ico 请求处理
    if (pathname === '/favicon.ico') {
        // 返回一个简单的透明1x1像素图标或404
        res.writeHead(204); // No Content
        res.end();
        return;
    }

    // 静态文件服务
    if (pathname === '/' || pathname === '/admin') {
        const path = require('path');
        const adminPath = path.join(__dirname, '..', 'admin', 'admin-legacy.html');
        fs.readFile(adminPath, 'utf8', (err, data) => {
            if (err) {
                console.error('读取管理后台文件失败:', err);
                res.writeHead(404);
                res.end('Admin file not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // 静态资源服务（CSS, JS文件）
    if (pathname.startsWith('/admin/')) {
        const path = require('path');
        const filePath = path.join(__dirname, '..', pathname);
        const ext = path.extname(filePath);
        
        let contentType = 'text/plain';
        if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.html') contentType = 'text/html';
        
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // 上传的图片静态服务
    if (pathname.startsWith('/uploads/')) {
        const path = require('path');
        const filePath = path.join(__dirname, '..', pathname);
        const ext = path.extname(filePath).toLowerCase();
        
        let contentType = 'application/octet-stream';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.bmp') contentType = 'image/bmp';
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Image not found');
                return;
            }
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000' // 1年缓存
            });
            res.end(data);
        });
        return;
    }

    // Webhook路由 - Telegram Bot更新
    if (pathname === '/webhook' && method === 'POST') {
        handleWebhookRequest(req, res);
        return;
    }

    // 健康检查端点
    if (pathname === '/health' && method === 'GET') {
        console.log(`🩺 健康检查请求 - ${new Date().toISOString()}`);
        
        // 检查关键服务状态
        const dbStatus = checkDatabaseConnection();
        const botStatus = checkBotStatus();
        
        const healthStatus = {
            success: dbStatus.connected && botStatus.connected,
            status: dbStatus.connected && botStatus.connected ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: {
                database: dbStatus,
                telegram_bot: botStatus
            },
            environment: process.env.NODE_ENV || 'development'
        };
        
        const statusCode = healthStatus.success ? 200 : 503;
        console.log(`🩺 健康检查响应 - 状态: ${healthStatus.status} (${statusCode})`);
        
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(healthStatus));
        return;
    }

    // 文件下载路由
    if (pathname.startsWith('/api/export/download/') && method === 'GET') {
        handleFileDownload(req, res, pathname);
        return;
    }

    // API路由
    if (pathname.startsWith('/api/')) {
        handleApiRequest(req, res, pathname, method);
        return;
    }

    // 404 - 返回JSON格式响应
    console.log(`❌ 404 - 路径不存在: ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ 
        error: 'Not Found',
        availableEndpoints: ['/health', '/admin', '/api/*', '/webhook']
    }));
}

// HTTP服务器和管理后台API
function createHttpServer() {
    const server = http.createServer(handleHttpRequest);
    return server;
}

// Webhook请求处理 - 处理Telegram更新
function handleWebhookRequest(req, res) {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        try {
            const update = JSON.parse(body);
            
            // 立即响应Telegram服务器
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('OK');
            
            // 处理更新（事件驱动，不阻塞响应）
            processWebhookUpdate(update);
            
        } catch (error) {
            console.error('Webhook处理错误:', error);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('OK'); // 总是返回200给Telegram
        }
    });
}

// 文件下载处理
function handleFileDownload(req, res, pathname) {
    try {
        const filename = pathname.split('/').pop();
        const path = require('path');
        const filePath = path.join(__dirname, '../exports', filename);
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '文件不存在' }));
            return;
        }
        
        // 获取文件信息
        const stats = fs.statSync(filePath);
        
        // 设置下载头
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stats.size);
        
        // 创建文件流并传输
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
            console.error('文件下载错误:', error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '文件下载失败' }));
            }
        });
        
        console.log(`📥 文件下载: ${filename} (${stats.size} bytes)`);
        
    } catch (error) {
        console.error('文件下载处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '下载处理失败' }));
    }
}

// API请求处理
function handleApiRequest(req, res, pathname, method) {
    // 解析查询参数
    const url = require('url');
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query || {};
    

    
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            let data = {};
            
            // 对于GET请求，使用查询参数
            if (method === 'GET') {
                data = queryParams;
            } else {
                // 对于POST/PUT/DELETE请求，使用body数据
                data = body ? JSON.parse(body) : {};
            }
            
            const response = await processApiRequest(pathname, method, data);
            
            sendResponse(res, 200, response, 'application/json');
        } catch (error) {
            console.error('API请求处理错误:', error);
            sendResponse(res, 500, { success: false, error: error.message }, 'application/json');
        }
    });
}

// API请求路由处理
async function processApiRequest(pathname, method, data) {
    // favicon处理
    if (pathname === '/favicon.ico') {
        return { 
            success: true, 
            statusCode: 204,
            headers: { 'Content-Type': 'image/x-icon' }
        };
    }

    // 手动播报API
    if (pathname === '/api/manual-broadcast' && method === 'POST') {
        try {
            const { orderId, broadcastType, customMessage } = data;
            
            if (!orderId) {
                return { success: false, error: '订单ID不能为空' };
            }

            console.log(`收到手动播报请求 - 订单ID: ${orderId}, 类型: ${broadcastType}, 自定义消息: ${customMessage}`);

            // 获取订单详情
            const order = dbOperations.getOrder(orderId);
            if (!order) {
                return { success: false, error: '订单不存在' };
            }

            // 获取商家信息
            const merchant = dbOperations.getMerchantById(order.merchant_id);
            if (!merchant) {
                return { success: false, error: '商家信息不存在' };
            }

            // 获取用户信息 - 避免重复添加@符号
            const rawUsername = order.user_username;
            const username = rawUsername ? 
                (rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`) : 
                '未设置用户名';
            const teacherName = merchant.teacher_name || '未知老师';

            // 构建播报消息
            let broadcastMessage;
            if (customMessage) {
                // 使用自定义消息
                broadcastMessage = customMessage;
            } else {
                // 使用默认格式
                if (broadcastType === 'real') {
                    broadcastMessage = `🎉 恭喜小鸡的勇士：用户（${username}）出击了 #${teacherName} 老师！
🐤 小鸡出征！咯咯哒咯咯哒～`;
                } else {
                    broadcastMessage = `🎉 恭喜小鸡的勇士：隐藏用户 出击了 #${teacherName} 老师！
🐤 小鸡出征！咯咯哒咯咯哒～`;
                }
            }

            // 检查群组配置
            const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
            if (!GROUP_CHAT_ID) {
                return { success: false, error: '群组配置未设置，请在环境变量中设置GROUP_CHAT_ID' };
            }

            // 检查Bot配置
            const BOT_TOKEN = process.env.BOT_TOKEN;
            const BOT_USERNAME = process.env.BOT_USERNAME;
            
            if (!BOT_TOKEN || BOT_TOKEN === 'your_local_bot_token_here' || 
                !BOT_USERNAME || BOT_USERNAME === 'your_local_bot_username_here') {
                console.log('Bot配置未完成，使用测试模式');
                return { 
                    success: true, 
                    message: '播报成功！（测试模式：Bot配置未完成）',
                    messageId: 'test_' + Date.now(),
                    testMode: true,
                    broadcastContent: broadcastMessage,
                    groupId: GROUP_CHAT_ID
                };
            }

            const bs = getBotService();
            if (!bs || !bs.bot) {
                console.log('Bot服务未初始化，使用测试模式');
                return { 
                    success: true, 
                    message: '播报成功！（测试模式：Bot服务未初始化）',
                    messageId: 'test_' + Date.now(),
                    testMode: true,
                    broadcastContent: broadcastMessage,
                    groupId: GROUP_CHAT_ID
                };
            }

            // 发送消息到群组
            try {
                const sentMessage = await bs.bot.sendMessage(GROUP_CHAT_ID, broadcastMessage);
                console.log(`手动播报消息发送成功, message_id: ${sentMessage.message_id}`);

                // 尝试置顶消息
                try {
                    await bs.bot.pinChatMessage(GROUP_CHAT_ID, sentMessage.message_id);
                    console.log(`播报消息已置顶: ${sentMessage.message_id}`);
                } catch (pinError) {
                    console.log(`置顶消息失败: ${pinError.message}`);
                    // 置顶失败不影响播报成功
                }

                return { 
                    success: true, 
                    message: '播报成功！消息已发送到群组',
                    messageId: sentMessage.message_id
                };
            } catch (botError) {
                console.log('Telegram发送失败，使用测试模式:', botError.message);
                return { 
                    success: true, 
                    message: '播报成功！（测试模式：Telegram发送失败）',
                    messageId: 'test_' + Date.now(),
                    testMode: true,
                    broadcastContent: broadcastMessage
                };
            }

        } catch (error) {
            console.error('手动播报失败:', error);
            console.error('错误详情:', error.message);
            console.error('错误堆栈:', error.stack);
            
            // 检查具体错误类型
            let errorMessage = '播报失败，请联系管理员';
            if (error.message.includes('chat not found')) {
                errorMessage = '播报失败：群组未找到，请检查群组ID配置';
            } else if (error.message.includes('not enough rights')) {
                errorMessage = '播报失败：机器人没有发送消息权限，请联系群组管理员';
            } else if (error.message.includes('bot was blocked')) {
                errorMessage = '播报失败：机器人被群组封禁，请联系群组管理员';
            } else {
                errorMessage = `播报失败：${error.message}`;
            }
            
            return { success: false, error: errorMessage };
        }
    }

    // 使用ApiService处理请求
    if (pathname.startsWith('/api/')) {
        try {
            // 延迟加载ApiService，避免循环依赖问题
            let apiService;
            try {
                apiService = require('./apiService');
            } catch (requireError) {
                console.log('ApiService暂不可用，使用原有逻辑处理请求');
                // 继续使用原有的处理逻辑
            }
            
            if (apiService) {
                // 正确分离query和body参数
                const query = method === 'GET' ? data : {};
                const body = method !== 'GET' ? data : {};
                
                const result = await apiService.handleRequest(method, pathname, query, body);
                
                // 如果ApiService成功处理了请求，直接返回结果
                if (result && result.success === true) {
                    return result;
                }
                
                // 如果ApiService返回404，说明路由不存在，继续使用原有逻辑
                if (result && result.status === 404) {
                    console.log(`ApiService未处理请求: ${method} ${pathname}, 使用原有逻辑`);
                } else if (result && result.success === false) {
                    // 如果ApiService处理失败，也尝试使用原有逻辑作为备用
                    console.log(`ApiService处理请求失败: ${method} ${pathname}，尝试使用原有逻辑`, result);
                } else {
                    // 只有成功的情况才直接返回
                    console.log(`ApiService处理请求失败: ${method} ${pathname}`, result);
                    return result;
                }
            }
        } catch (error) {
            console.error('ApiService处理失败:', error);
            // 如果ApiService处理失败，继续使用原有的处理逻辑
        }
    }
    

    
    // 绑定码管理API
    if (pathname === '/api/bind-codes') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getAllBindCodes() };
        } else if (method === 'POST') {
            const result = dbOperations.createBindCode(data.description);
            await safeLoadCacheData();
            return { success: true, data: result };
        }
    }

    // 处理单个绑定码的删除和强制删除
    if (pathname.match(/^\/api\/bind-codes\/\d+$/)) {
        const bindCodeId = parseInt(pathname.split('/')[3]);
        
        if (method === 'DELETE') {
            try {
                // 使用统一的依赖检查方法
                const dependencies = dbOperations.checkBindCodeDependencies(bindCodeId);
                
                if (!dependencies.exists) {
                    return { success: false, error: '绑定码不存在' };
                }
                
                if (!dependencies.canDelete) {
                    return { 
                        success: false, 
                        error: dependencies.merchant 
                            ? `绑定码已被商家 ${dependencies.merchant.teacher_name} 使用，无法删除。如需强制删除，请使用强制删除功能。`
                            : '绑定码已被使用，无法删除。如需强制删除，请使用强制删除功能。',
                        code: 'BIND_CODE_IN_USE',
                        merchant: dependencies.merchant
                    };
                }
                
                // 删除未使用的绑定码
                const result = dbOperations.deleteBindCode(bindCodeId);
                await safeLoadCacheData();
                
                return { 
                    success: true, 
                    status: 200,
                    message: '绑定码删除成功',
                    data: {
                        deletedCount: result.changes
                    }
                };
            } catch (error) {
                console.error('删除绑定码失败:', error);
                return { success: false, error: error.message };
            }
        }
    }

    // 强制删除绑定码API
    if (pathname.match(/^\/api\/bind-codes\/\d+\/force$/)) {
        const bindCodeId = parseInt(pathname.split('/')[3]);
        
        if (method === 'DELETE') {
            try {
                const result = dbOperations.forceDeleteBindCode(bindCodeId);
                await safeLoadCacheData();
                
                return { 
                    success: true, 
                    status: 200,
                    message: result.deletedMerchant ? '绑定码及相关商家记录已强制删除' : '绑定码已删除',
                    data: {
                        deletedMerchant: result.deletedMerchant
                    }
                };
            } catch (error) {
                console.error('强制删除绑定码失败:', error);
                return { success: false, error: error.message };
            }
        }
    }

    // 批量删除测试绑定码API
    if (pathname === '/api/bind-codes/batch-delete-test' && method === 'DELETE') {
        try {
            // 获取所有描述包含"测试"的绑定码
            const { db } = require('../config/database');
            const testBindCodes = db.prepare(`
                SELECT * FROM bind_codes 
                WHERE description LIKE '%测试%' OR description LIKE '%test%'
            `).all();
            
            let deletedCount = 0;
            let deletedMerchants = 0;
            
            for (const bindCode of testBindCodes) {
                try {
                    // 如果绑定码已被使用，先删除相关商家
                    if (bindCode.used_by) {
                        const merchant = db.prepare('SELECT * FROM merchants WHERE bind_code = ?').get(bindCode.code);
                        if (merchant) {
                            dbOperations.deleteMerchant(merchant.id);
                            deletedMerchants++;
                        }
                    }
                    
                    // 删除绑定码
                    const result = dbOperations.deleteBindCode(bindCode.id);
                    if (result.changes > 0) {
                        deletedCount++;
                    }
                } catch (error) {
                    console.error(`删除测试绑定码 ${bindCode.code} 失败:`, error);
                }
            }
            
            await safeLoadCacheData();
            
            return { 
                success: true, 
                status: 200,
                message: `批量删除成功！删除了 ${deletedCount} 个测试绑定码${deletedMerchants > 0 ? `，${deletedMerchants} 个相关商家` : ''}`,
                data: {
                    deletedCount,
                    deletedMerchants
                }
            };
        } catch (error) {
            console.error('批量删除测试绑定码失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 地区管理API
    if (pathname === '/api/regions') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getAllRegions() };
        } else if (method === 'POST') {
            const result = dbOperations.createRegion(data.name, data.sortOrder);
            await safeLoadCacheData();
            return { success: true, data: { id: result } };
        } else if (method === 'PUT') {
            dbOperations.updateRegion(data.id, data.name, data.sortOrder);
            await safeLoadCacheData();
            return { success: true };
        } else if (method === 'DELETE') {
            try {
            dbOperations.deleteRegion(data.id);
            await safeLoadCacheData();
                return { success: true, message: '地区删除成功' };
            } catch (error) {
                console.error('删除地区失败:', error);
                return { success: false, error: error.message };
        }
        }
    }

    // 检查地区依赖关系API
    if (pathname.match(/^\/api\/regions\/\d+\/dependencies$/) && method === 'GET') {
        const regionId = pathname.split('/')[3];
        const dependencies = dbOperations.checkRegionDependencies(regionId);
        return { success: true, data: dependencies };
    }

    // 商家管理API
    if (pathname === '/api/merchants') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getAllMerchants() };
        } else if (method === 'POST') {
            try {
                if (!data.teacher_name || !data.username) {
                    return { success: false, error: '商家名称和用户名不能为空' };
                }
                
                let bindCode;
                let bindCodeRecord;
                
                // 如果提供了绑定码，验证其有效性
                if (data.bind_code) {
                    bindCodeRecord = dbOperations.getBindCode(data.bind_code);
                    if (!bindCodeRecord || bindCodeRecord.used) {
                        return { success: false, error: '提供的绑定码无效或已被使用' };
                    }
                    bindCode = data.bind_code;
                } else {
                    // 如果没有提供绑定码，自动创建一个
                    bindCodeRecord = dbOperations.createBindCode(`管理员创建: ${data.teacher_name} (@${data.username})`);
                    if (!bindCodeRecord) {
                        return { success: false, error: '创建绑定码失败' };
                    }
                    bindCode = bindCodeRecord.code;
                }
                
                // 尝试通过用户名自动检测Telegram ID
                let detectedUserId = null;
                const username = data.username.replace('@', '');
                
                try {
                    const botService = getBotService();
                    if (botService && botService.bot) {
                        // 尝试通过用户名获取用户信息
                        console.log(`🔍 尝试检测用户名 @${username} 的Telegram ID...`);
                        
                        // 方法1：尝试通过Chat API获取用户信息
                        try {
                            const chatInfo = await botService.bot.getChat(`@${username}`);
                            if (chatInfo && chatInfo.id) {
                                detectedUserId = chatInfo.id;
                                console.log(`✅ 成功检测到用户ID: ${detectedUserId} (通过Chat API)`);
                            }
                        } catch (chatError) {
                            console.log(`⚠️ Chat API检测失败: ${chatError.message}`);
                        }
                        
                        // 方法2：如果Chat API失败，尝试查找数据库中是否有相同用户名的记录
                        if (!detectedUserId) {
                            const { db } = require('../config/database');
                            const existingUser = db.prepare('SELECT user_id FROM merchants WHERE LOWER(username) = LOWER(?) AND user_id IS NOT NULL LIMIT 1').get(username);
                            if (existingUser && existingUser.user_id) {
                                detectedUserId = existingUser.user_id;
                                console.log(`✅ 从数据库中找到用户ID: ${detectedUserId} (通过历史记录)`);
                            }
                        }
                        
                        if (!detectedUserId) {
                            console.log(`⚠️ 无法自动检测用户名 @${username} 的Telegram ID，将等待用户主动绑定`);
                        }
                    }
                } catch (detectionError) {
                    console.log(`⚠️ 自动检测用户ID失败: ${detectionError.message}`);
                }
                
                // 创建商家记录
                const merchantData = {
                    user_id: detectedUserId, // 如果检测到了就直接设置，否则为null等待绑定
                    username: username,
                    bind_code: bindCode,
                    bind_step: 5, // 直接设置为完成状态
                    status: 'active',
                    teacher_name: data.teacher_name
                };
                
                const merchantId = dbOperations.createMerchantSimple(merchantData);
                
                if (!merchantId) {
                    return { success: false, error: '创建商家记录失败' };
                }
                
                // 如果检测到了用户ID，标记绑定码为已使用
                if (detectedUserId) {
                    dbOperations.useBindCode(bindCode, detectedUserId);
                }
                
                await safeLoadCacheData();
                
                const message = detectedUserId 
                    ? `商家创建成功，已自动检测到Telegram ID: ${detectedUserId}` 
                    : '商家创建成功，等待用户使用绑定码进行绑定';
                
                return { 
                    success: true, 
                    merchantId, 
                    bindCode: bindCode,
                    detectedUserId,
                    message
                };
            } catch (error) {
                console.error('创建商家失败:', error);
                return { success: false, error: '创建商家失败: ' + error.message };
            }
        }
    }

    // 检查商家依赖关系API
    if (pathname.match(/^\/api\/merchants\/\d+\/dependencies$/) && method === 'GET') {
        const merchantId = pathname.split('/')[3];
        const dependencies = dbOperations.checkMerchantDependencies(merchantId);
        return { success: true, data: dependencies };
    }

    // 删除商家API
    if (pathname.match(/^\/api\/merchants\/\d+$/) && method === 'DELETE') {
        const merchantId = pathname.split('/')[3];
        try {
            console.log(`🗑️ 开始删除商家 ID: ${merchantId}`);
            const result = dbOperations.deleteMerchant(merchantId);
            console.log(`✅ 商家删除成功，影响行数: ${result.changes}`);
            
            // 重新加载缓存数据
            await safeLoadCacheData();
            console.log(`🔄 缓存数据已重新加载`);
            
            return { success: true, message: '商家删除成功', deletedId: merchantId };
        } catch (error) {
            console.error('❌ 删除商家失败:', error);
            throw new Error('删除商家失败: ' + error.message);
        }
    }

    // 商家绑定状态重置API
    if (pathname.match(/^\/api\/merchants\/\d+\/reset$/) && method === 'POST') {
        const merchantId = pathname.split('/')[3];
        dbOperations.resetMerchantBind(merchantId);
        await safeLoadCacheData();
        return { success: true };
    }

    // 更新商家信息API
    if (pathname.match(/^\/api\/merchants\/\d+$/) && method === 'PUT') {
        const merchantId = pathname.split('/')[3];
        
        // 检查是否是模板更新（包含更多字段）
        if (data.advantages !== undefined || data.disadvantages !== undefined || 
            data.price1 !== undefined || data.price2 !== undefined ||
            data.skillWash !== undefined || data.skillBlow !== undefined ||
            data.skillDo !== undefined || data.skillKiss !== undefined ||
            data.channelLink !== undefined) {
            // 使用新的模板更新方法
            dbOperations.updateMerchantTemplate(merchantId, data);
        } else {
            // 使用原有的基本信息更新方法
            dbOperations.updateMerchant(merchantId, data.teacherName, data.regionId, data.contact);
        }

        // 如果包含绑定码，单独更新绑定码
        if (data.bindCode !== undefined) {
            dbOperations.updateMerchantBindCode(merchantId, data.bindCode);
        }
        
        await safeLoadCacheData();
        return { success: true };
    }

    // 暂停/恢复商家API
    if (pathname.match(/^\/api\/merchants\/\d+\/toggle-status$/) && method === 'POST') {
        const merchantId = pathname.split('/')[3];
        dbOperations.toggleMerchantStatus(merchantId);
        await safeLoadCacheData();
        return { success: true };
    }

    // 按钮管理API
    if (pathname === '/api/buttons') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getButtons() };
        } else if (method === 'POST') {
            const result = dbOperations.createButton(data.title, data.message, data.merchantId);
            await safeLoadCacheData();
            return { success: true, data: { id: result } };
        } else if (method === 'DELETE') {
            dbOperations.deleteButton(data.id);
            await safeLoadCacheData();
            return { success: true };
        }
    }

    // 消息模板管理API
    if (pathname === '/api/templates') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getMessageTemplates() };
        } else if (method === 'POST') {
            const result = dbOperations.createMessageTemplate(
                data.name, data.content, data.imageUrl, data.buttonsConfig
            );
            await safeLoadCacheData();
            return { success: true, data: { id: result } };
        } else if (method === 'PUT') {
            dbOperations.updateMessageTemplate(
                data.id, data.name, data.content, data.imageUrl, data.buttonsConfig
            );
            await safeLoadCacheData();
            return { success: true };
        } else if (method === 'DELETE') {
            dbOperations.deleteMessageTemplate(data.id);
            await safeLoadCacheData();
            return { success: true };
        }
    }

    // 触发词管理API
    if (pathname === '/api/triggers') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getTriggerWords() };
        } else if (method === 'POST') {
            const result = dbOperations.createTriggerWord(
                data.word, data.templateId, data.matchType, data.chatId
            );
            await safeLoadCacheData();
            return { success: true, data: { id: result } };
        } else if (method === 'DELETE') {
            dbOperations.deleteTriggerWord(data.id);
            await safeLoadCacheData();
            return { success: true };
        }
    }

    // 定时任务管理API
    if (pathname === '/api/tasks') {
        if (method === 'GET') {
            return { success: true, data: dbOperations.getScheduledTasks() };
        } else if (method === 'POST') {
            const result = dbOperations.createScheduledTask(
                data.name, data.templateId, data.chatId, data.scheduleType,
                data.scheduleTime, data.sequenceOrder, data.sequenceDelay
            );
            await safeLoadCacheData();
            return { success: true, data: { id: result } };
        } else if (method === 'DELETE') {
            dbOperations.deleteScheduledTask(data.id);
            await safeLoadCacheData();
            return { success: true };
        }
    }

    // 统计数据API
    if (pathname === '/api/stats' && method === 'GET') {
        const stats = dbOperations.getInteractionStats();
        const cacheData = getCacheData();
        
        // 获取真实的点击统计 - 只统计用户点击"预约老师课程"按钮的次数
        const db = require('../config/database').getInstance().db;
        const attackClicks = db.prepare('SELECT COUNT(*) as count FROM interactions WHERE action_type = ?').get('attack_click').count;
        const totalClicks = attackClicks; // 总点击数就是预约按钮点击数
        
        // 获取实际数据库计数
        const bindCodes = dbOperations.getAllBindCodes();
        const regions = dbOperations.getAllRegions();
        
        return {
            success: true,
            data: {
                totalMerchants: cacheData.merchants.length,
                totalButtons: cacheData.buttons.length,
                totalTemplates: cacheData.messageTemplates.length,
                totalTriggers: cacheData.triggerWords.length,
                totalTasks: cacheData.scheduledTasks.length,
                totalBindCodes: bindCodes.length,
                totalRegions: regions.length,
                totalClicks: totalClicks,
                attackClicks: attackClicks,
                ...stats
            }
        };
    }

    // 管理员密码验证API
    if (pathname === '/api/admin/verify-password' && method === 'POST') {
        try {
            const { password } = data;
            if (!password) {
                return { success: false, error: '密码不能为空' };
            }
            
            const { verifyAdminPassword } = require('./merchantService');
            const isValid = verifyAdminPassword(password);
            
            return {
                success: true,
                valid: isValid
            };
        } catch (error) {
            console.error('验证管理员密码失败:', error);
            return {
                success: false,
                error: '验证失败'
            };
        }
    }

    // 测试发送API - 需要在通用API处理器之前处理
    if (pathname === '/api/test-send' && method === 'POST') {
        try {
            const bs = getBotService();
            if (!bs || !bs.bot) {
                return { success: false, error: 'Bot服务未初始化' };
            }

            const { chatId, groupId, type, merchantId, templateId, message, imageUrl, buttonsConfig } = data;
            
            // 兼容前端的参数名
            const targetChatId = chatId || groupId;
            
            // 验证必要参数
            if (!targetChatId) {
                return { success: false, error: '请输入群组ID' };
            }

            let messageContent = '';
            let sendOptions = {};

            // 根据发送类型构建消息内容
            if (type === 'merchant') {
                if (!merchantId) {
                    return { success: false, error: '请选择商家' };
                }
                
                const merchant = dbOperations.getMerchantById(merchantId);
                if (!merchant) {
                    return { success: false, error: '商家不存在' };
                }

                // 构建商家信息消息，使用正确的数据库字段名
                messageContent = `地区：#${merchant.region_name || 'xx'}              艺名：${merchant.teacher_name || '未填写'}
优点：${merchant.advantages || '未填写'}
缺点：${merchant.disadvantages || '未填写'}
价格：${merchant.price1 || '未填写'}p              ${merchant.price2 || '未填写'}pp

老师💃自填基本功：
${dbOperations.formatMerchantSkillsDisplay(merchant.id)}`;

                // 添加跳转到私聊的按钮
                let botUsername;
                
                // 使用统一的Bot用户名获取机制
                try {
                    const bs = getBotService();
                    if (bs && bs.getBotUsername) {
                        botUsername = await bs.getBotUsername();
                    } else {
                        throw new Error('Bot服务未初始化');
                    }
                } catch (error) {
                    console.error('获取bot用户名失败:', error);
                    // 从环境变量获取bot用户名
                    botUsername = process.env.BOT_USERNAME;
                    if (!botUsername) {
                        console.error('❌ BOT_USERNAME 环境变量未设置');
                        return { success: false, error: 'Bot配置未设置，请联系管理员' };
                    }
                }
                
                // 构建按钮 - 群内发送时所有按钮都跳转到机器人
                const buttons = [
                    [{ text: '预约老师课程', url: `https://t.me/${botUsername}?start=merchant_${merchantId}` }]
                ];
                
                // 如果商家有频道链接，添加"关注老师频道"按钮
                if (merchant.channel_link && merchant.channel_link.trim()) {
                    buttons.push([{ text: '关注老师频道', url: `https://t.me/${botUsername}?start=merchant_${merchantId}` }]);
                }
                
                // 添加"返回榜单"按钮
                buttons.push([{ text: '返回榜单', url: `https://t.me/${botUsername}?start=xiaoji899` }]);
                
                sendOptions.reply_markup = {
                    inline_keyboard: buttons
                };

                // 如果商家有图片，使用商家图片；否则使用自定义图片
                if (merchant.image_url && merchant.image_url.trim()) {
                    sendOptions.caption = messageContent;
                    sendOptions.photo = merchant.image_url;
                } else if (imageUrl) {
                    sendOptions.caption = messageContent;
                    sendOptions.photo = imageUrl;
                }
            } else if (type === 'dailyHot') {
                // 当日热门老师
                const apiService = require('./apiService');
                const hotResult = await apiService.generateDailyHotMessage({ query: {} });
                
                if (!hotResult.success) {
                    return { success: false, error: hotResult.message || '获取当日热门数据失败' };
                }
                
                messageContent = hotResult.message;
                sendOptions.parse_mode = 'HTML';
                
            } else if (type === 'template') {
                if (!templateId) {
                    return { success: false, error: '请选择消息模板' };
                }
                
                const template = dbOperations.getMessageTemplateById(templateId);
                if (!template) {
                    return { success: false, error: '消息模板不存在' };
                }
                
                messageContent = template.content;
                
                // 如果模板有图片，使用模板图片
                if (template.image_url) {
                    sendOptions.caption = messageContent;
                    sendOptions.photo = template.image_url;
                }
            } else if (type === 'custom') {
                if (!message || !message.trim()) {
                    return { success: false, error: '请输入消息内容' };
                }
                messageContent = message;
                
                // 如果有图片，添加图片
                if (imageUrl) {
                    sendOptions.caption = messageContent;
                    sendOptions.photo = imageUrl;
                }
                
                // 如果有按钮配置，添加按钮
                if (buttonsConfig && buttonsConfig.length > 0) {
                    sendOptions.reply_markup = {
                        inline_keyboard: buttonsConfig
                    };
                }
            } else {
                return { success: false, error: '无效的发送类型' };
            }

            // 发送消息
            let result;
            if (sendOptions.photo) {
                // 发送图片消息
                const photoOptions = {
                    caption: sendOptions.caption,
                    parse_mode: 'HTML',
                    show_caption_above_media: true
                };
                if (sendOptions.reply_markup) {
                    photoOptions.reply_markup = sendOptions.reply_markup;
                }
                
                // 如果是base64图片数据，转换为Buffer
                let photoData = sendOptions.photo;
                if (typeof photoData === 'string' && photoData.startsWith('data:image/')) {
                    // 从base64 data URL中提取数据
                    const base64Data = photoData.split(',')[1];
                    photoData = Buffer.from(base64Data, 'base64');
                }
                
                result = await bs.bot.sendPhoto(targetChatId, photoData, photoOptions);
            } else {
                // 发送文本消息
                const textOptions = {
                    parse_mode: 'HTML'
                };
                if (sendOptions.reply_markup) {
                    textOptions.reply_markup = sendOptions.reply_markup;
                }
                result = await bs.bot.sendMessage(targetChatId, messageContent, textOptions);
            }

            console.log('✅ 测试消息发送成功:', {
                chatId: targetChatId,
                messageId: result.message_id,
                type,
                merchantId,
                templateId
            });

            return {
                success: true,
                message: '消息发送成功',
                data: {
                    messageId: result.message_id,
                    chatId: targetChatId
                }
            };

        } catch (error) {
            console.error('❌ 测试发送失败:', error);
            
            // 处理常见错误
            if (error.code === 'ETELEGRAM') {
                if (error.response && error.response.description) {
                    if (error.response.description.includes('chat not found')) {
                        return { success: false, error: '群组不存在或机器人未加入该群组' };
                    } else if (error.response.description.includes('not enough rights')) {
                        return { success: false, error: '机器人在该群组中没有发送消息的权限' };
                    } else if (error.response.description.includes('blocked')) {
                        return { success: false, error: '机器人被该群组屏蔽' };
                    }
                    return { success: false, error: `Telegram错误: ${error.response.description}` };
                }
            }
            
            return { 
                success: false, 
                error: `发送失败: ${error.message}` 
            };
        }
    }

    // 商家预约统计API
    if (pathname === '/api/merchant-bookings' && method === 'GET') {
        const bookingStats = dbOperations.getMerchantBookingStats();
        return {
            success: true,
            data: bookingStats
        };
    }

    // 消息统计API
    if (pathname === '/api/message-stats' && method === 'GET') {
        const messageStats = dbOperations.getMessageStats();
        return {
            success: true,
            data: messageStats
        };
    }

    // 最近预约记录API
    if (pathname === '/api/recent-bookings' && method === 'GET') {
        const recentBookings = dbOperations.getRecentBookings(20);
        return {
            success: true,
            data: recentBookings
        };
    }

    // 按钮点击统计API
    if (pathname === '/api/button-stats' && method === 'GET') {
        const buttonStats = dbOperations.getButtonClickStats();
        return {
            success: true,
            data: buttonStats
        };
    }

    // 评价管理API
    if (pathname === '/api/evaluations' && method === 'GET') {
        const evaluations = dbOperations.getAllEvaluations();
        return {
            success: true,
            data: evaluations
        };
    }

    // 评价详情API
    if (pathname.match(/^\/api\/evaluations\/\d+$/) && method === 'GET') {
        const evaluationId = pathname.split('/')[3];
        const evaluation = dbOperations.getEvaluationDetails(evaluationId);
        if (!evaluation) {
            return {
                success: false,
                error: '订单不存在或无评价数据'
            };
        }
        return {
            success: true,
            data: evaluation
        };
    }

    // 评价统计API
    if (pathname === '/api/evaluation-stats' && method === 'GET') {
        const stats = dbOperations.getEvaluationStats();
        return {
            success: true,
            data: stats
        };
    }

    // 订单评价API
    if (pathname === '/api/order-evaluations' && method === 'GET') {
        const orderEvaluations = dbOperations.getOrderEvaluations();
        return {
            success: true,
            data: orderEvaluations
        };
    }

    // 简单计数API
    if (pathname.startsWith('/api/simple-count/') && method === 'GET') {
        try {
            const tableName = pathname.split('/')[3];
            const apiService = require('./apiService');
            const result = await apiService.getSimpleCount({ params: { table: tableName } });
            return result;
        } catch (error) {
            console.error('获取简单计数失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 图表API路由
    if (pathname === '/api/charts/orders-trend' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getOrdersTrendChart({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取订单趋势图表失败:', error);
            return { success: false, error: error.message };
        }
    }

    if (pathname === '/api/charts/region-distribution' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getRegionDistributionChart({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取地区分布图表失败:', error);
            return { success: false, error: error.message };
        }
    }

    if (pathname === '/api/charts/price-distribution' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getPriceDistributionChart({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取价格分布图表失败:', error);
            return { success: false, error: error.message };
        }
    }

    if (pathname === '/api/charts/status-distribution' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getStatusDistributionChart({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取状态分布图表失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 频道点击相关API
    if (pathname === '/api/channel-clicks/recent' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getRecentChannelClicks({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取最新频道点击失败:', error);
            return { success: false, error: error.message };
        }
    }

    if (pathname === '/api/channel-clicks/stats' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getChannelClicksStats({ query: data || {} });
            return result;
        } catch (error) {
            console.error('获取频道点击统计失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 订单详情API
    if (pathname.match(/^\/api\/orders\/\d+$/) && method === 'GET') {
        try {
            const orderId = pathname.split('/')[3];
            const apiService = require('./apiService');
            const result = await apiService.getOrderById({ params: { id: orderId } });
            return {
                success: true,
                ...result
            };
        } catch (error) {
            console.error('获取订单详情失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 获取Bot用户名
    if (pathname === '/api/bot-username' && method === 'GET') {
        try {
            // 优先使用环境变量
            if (process.env.BOT_USERNAME) {
                console.log(`✅ 使用环境变量BOT_USERNAME: ${process.env.BOT_USERNAME}`);
                return {
                    success: true,
                    username: process.env.BOT_USERNAME
                };
            }
            
            // 尝试从Bot服务获取
            const bs = getBotService();
            if (bs && bs.getBotUsername) {
                const botUsername = await bs.getBotUsername();
                return {
                    success: true,
                    username: botUsername
                };
            }
            
            // 如果都不可用，返回默认值
            console.warn('⚠️ Bot用户名获取失败，使用默认值');
            return {
                success: true,
                username: 'xiaojisystem_bot' // 默认值 - 修正为正确的bot用户名
            };
            
        } catch (error) {
            console.error('获取Bot用户名失败:', error);
            // 即使出错也返回默认值，确保前端能正常工作
            return {
                success: true,
                username: 'xiaojisystem_bot' // 修正为正确的bot用户名
            };
        }
    }

    // 商家排名API - 支持多种排名类型
    if (pathname === '/api/rankings/merchants' && method === 'GET') {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const rankingType = url.searchParams.get('type') || 'monthlyOrders';
            const regionId = url.searchParams.get('regionId');
            const period = url.searchParams.get('period') || 'month';
            const dateFrom = url.searchParams.get('dateFrom');
            const dateTo = url.searchParams.get('dateTo');
            
            console.log('商家排名API参数:', { rankingType, regionId, period, dateFrom, dateTo });
            
            let rankings = [];
            
            // 统一使用apiService处理所有排名类型，包括频道点击排名
                const apiService = require('./apiService');
            const queryParams = {
                type: rankingType,
                regionId,
                period
            };
            
            // 添加时间参数
            if (dateFrom) queryParams.dateFrom = dateFrom;
            if (dateTo) queryParams.dateTo = dateTo;
            
                const result = await apiService.getMerchantRankings({
                query: queryParams
                });
            
                rankings = result.data || result.rankings || [];
            
            // 为每个商家添加排名序号
            rankings = rankings.map((merchant, index) => ({
                ...merchant,
                rank: index + 1
            }));
            
            console.log(`获取到 ${rankings.length} 个商家排名结果`);
            
            return {
                success: true,
                data: rankings
            };
        } catch (error) {
            console.error('获取商家排名失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 当日热门老师API
    if (pathname === '/api/daily-hot-teachers' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.getDailyHotTeachers({ query: data });
            return result;
        } catch (error) {
            console.error('获取当日热门老师失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 生成当日热门消息API
    if (pathname === '/api/daily-hot-message' && method === 'GET') {
        try {
            const apiService = require('./apiService');
            const result = await apiService.generateDailyHotMessage({ query: data });
            return result;
        } catch (error) {
            console.error('生成当日热门消息失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // API路由不存在
    console.log(`❌ API路径不存在: ${pathname} (${method})`);
    return { 
        success: false, 
        error: 'API路径不存在',
        availableEndpoints: [
            'GET /api/stats',
            'GET /api/orders', 
            'GET /api/bind-codes',
            'GET /api/regions',
            'GET /api/merchants',
            'GET /api/rankings/merchants',
            'GET /api/rankings/users',
            'GET /api/charts/*',
            'GET /api/daily-hot-teachers',
            'GET /api/daily-hot-message',
            'GET /api/bot-username'
        ]
    };
}

// Webhook更新处理 - 事件驱动机制
function processWebhookUpdate(update) {
    try {
        // 获取Bot服务实例（通过全局引用或依赖注入）
        const bs = getBotService();
        if (!bs || !bs.bot) {
            console.error('❌ Bot服务实例不存在');
            return;
        }

        // 处理文本消息
        if (update.message && update.message.text) {
            // 模拟bot.on('message')事件
            setImmediate(() => {
                bs.bot.emit('message', update.message);
            });
        }

        // 处理callback query
        if (update.callback_query) {
            // 模拟bot.on('callback_query')事件
            setImmediate(() => {
                bs.bot.emit('callback_query', update.callback_query);
            });
        }

        // 处理其他类型的更新
        if (update.inline_query) {
            setImmediate(() => {
                bs.bot.emit('inline_query', update.inline_query);
            });
        }

    } catch (error) {
        console.error('❌ 处理webhook更新失败:', error);
    }
}

// 检查数据库连接状态
function checkDatabaseConnection() {
    try {
        const { db } = require('../config/database');
        // 执行简单查询测试连接
        const result = db.prepare('SELECT 1 as test').get();
        return {
            connected: result && result.test === 1,
            error: null
        };
    } catch (error) {
        console.error('数据库连接检查失败:', error);
        return {
            connected: false,
            error: error.message
        };
    }
}

// 检查机器人状态
function checkBotStatus() {
    try {
        const bs = getBotService();
        // 检查bot实例是否存在且已初始化
        if (!bs || !bs.bot || !bs.bot.token) {
            return {
                connected: false,
                error: 'Bot未初始化'
            };
        }
        
        // 检查bot是否正在运行
        return {
            connected: true,
            token_prefix: bs.bot.token.substring(0, 5) + '...',
            webhook_info: bs.bot.hasOpenWebHook ? 'active' : 'inactive'
        };
    } catch (error) {
        console.error('Bot状态检查失败:', error);
        return {
            connected: false,
            error: error.message
        };
    }
}

// 发送消息到群组
async function sendMessageToGroup(groupId, message, options = {}) {
    try {
        const bs = getBotService();
        if (!bs || !bs.bot) {
            throw new Error('Bot实例未初始化');
        }
        
        const sendOptions = {
            parse_mode: 'HTML',
            ...options
        };
        
        const result = await bs.bot.sendMessage(groupId, message, sendOptions);
        return {
            success: true,
            messageId: result.message_id,
            chatId: result.chat.id
        };
    } catch (error) {
        console.error('发送群组消息失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 发送消息到用户
async function sendMessageToUser(userId, message, options = {}) {
    try {
        const bs = getBotService();
        if (!bs || !bs.bot) {
            throw new Error('Bot实例未初始化');
        }
        
        const sendOptions = {
            parse_mode: 'HTML',
            ...options
        };
        
        const result = await bs.bot.sendMessage(userId, message, sendOptions);
        return {
            success: true,
            messageId: result.message_id,
            chatId: result.chat.id
        };
    } catch (error) {
        console.error('发送用户消息失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 压缩响应数据
function compressResponse(data, acceptEncoding) {
    if (!acceptEncoding || data.length < COMPRESSION_THRESHOLD) {
        return { data, encoding: null };
    }
    
    if (acceptEncoding.includes('gzip')) {
        return { data: zlib.gzipSync(data), encoding: 'gzip' };
    } else if (acceptEncoding.includes('deflate')) {
        return { data: zlib.deflateSync(data), encoding: 'deflate' };
    }
    
    return { data, encoding: null };
}

// 设置缓存头功能已整合到sendResponse函数中

function sendResponse(res, statusCode, data, contentType = 'application/json') {
    try {
        // 检查响应是否已经发送
        if (res.headersSent) {
            console.log('响应头已发送，跳过重复发送');
            return;
        }
        
        let responseData;
        
        if (contentType === 'application/json') {
            responseData = JSON.stringify(data);
        } else {
            responseData = data;
        }
        
        // 应用压缩
        const acceptEncoding = res.req.headers['accept-encoding'] || '';
        const compressed = compressResponse(Buffer.from(responseData), acceptEncoding);
        
        // 构建响应头
        const headers = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Length': compressed.data.length
        };
        
        // 添加压缩编码头
        if (compressed.encoding) {
            headers['Content-Encoding'] = compressed.encoding;
        }
        
        // 对于GET请求的API数据，添加缓存头
        if (res.req.method === 'GET' && res.req.url.startsWith('/api/')) {
            // 对于经常变动的数据（如绑定码、商家等），禁用缓存
            if (res.req.url.includes('/bind-codes') || res.req.url.includes('/merchants') || res.req.url.includes('/orders')) {
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
            } else {
                // 其他相对稳定的数据可以短期缓存
                headers['Cache-Control'] = `public, max-age=60`; // 1分钟缓存
                headers['ETag'] = `"${Date.now()}"`;
            }
        }
        
        // 设置响应头并发送数据
        res.writeHead(statusCode, headers);
        res.end(compressed.data);
        
    } catch (error) {
        console.error('发送响应失败:', error);
        // 只有在响应头未发送时才尝试发送错误响应
        if (!res.headersSent) {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '服务器内部错误' }));
            } catch (secondError) {
                console.error('发送错误响应也失败:', secondError);
            }
        }
    }
}



module.exports = {
    createHttpServer,
    handleHttpRequest,
    processApiRequest,
    sendMessageToGroup,
    sendMessageToUser,
    checkDatabaseConnection,
    checkBotStatus
}; 