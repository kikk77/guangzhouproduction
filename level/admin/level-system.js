// 等级系统管理界面JavaScript

// 全局变量
let currentPage = 1;
let pageSize = 20;
let levelChart = null;
let allUsers = [];
let allBadges = [];
let currentUserId = null;
let currentGroupId = 'default';
let groupConfigs = {};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('🏆 等级系统管理界面初始化开始...');
    
    // 检查等级系统是否启用
    checkLevelSystemStatus();
    
    // 加载统计数据
    loadStats();
    
    // 加载初始数据
    loadInitialData();
    
    // 初始化标签页
    initTabs();
    
    // 加载用户列表
    loadUsers();
    
    // 初始化搜索
    initSearch();
    
    console.log('✅ 等级系统管理界面初始化完成');
});

// 检查等级系统状态
async function checkLevelSystemStatus() {
    console.log('🔍 检查等级系统状态...');
    try {
        const response = await fetch('/api/level/stats');
        console.log('API响应状态:', response.status);
        
        if (!response.ok) {
            const error = await response.json();
            console.error('API错误:', error);
            if (error.error === '等级系统未启用') {
                showError('等级系统未启用，请在环境变量中设置 LEVEL_SYSTEM_ENABLED=true');
                const container = document.querySelector('.level-container');
                if (container) {
                    container.style.opacity = '0.5';
                }
            }
        } else {
            console.log('✅ 等级系统状态正常');
        }
    } catch (error) {
        console.error('检查等级系统状态失败:', error);
        showError('无法连接到服务器，请检查服务是否运行');
    }
}

// 加载统计数据
async function loadStats() {
    try {
        const response = await fetch('/api/level/stats');
        const result = await response.json();
        
        if (result.success) {
            const stats = result.data;
            
            // 更新统计卡片
            document.getElementById('totalUsers').textContent = stats.totalUsers || 0;
            document.getElementById('activeUsers').textContent = stats.activeUsers || 0;
            document.getElementById('totalBadges').textContent = stats.totalBadges || 0;
            document.getElementById('totalBadgesUnlocked').textContent = stats.totalBadgesUnlocked || 0;
            
            // 绘制等级分布图表
            drawLevelChart(stats.levelDistribution || []);
            
            // 更新排行榜
            updateRanking(stats.topUsers || []);
        }
    } catch (error) {
        console.error('加载统计数据失败:', error);
        showError('加载统计数据失败');
    }
}

// 绘制等级分布图表
function drawLevelChart(distribution) {
    try {
        // 检查Chart.js是否加载
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js未加载，跳过图表绘制');
            return;
        }
        
        const canvas = document.getElementById('levelChart');
        if (!canvas) {
            console.warn('找不到图表canvas元素');
            return;
        }
        
        const ctx = canvas.getContext('2d');
        
        if (levelChart) {
            levelChart.destroy();
        }
        
        const levelNames = ['Lv.1 新手', 'Lv.2 熟练', 'Lv.3 精英', 'Lv.4 大师', 'Lv.5 传说'];
        const labels = distribution.map(d => levelNames[d.level - 1] || `Lv.${d.level}`);
        const data = distribution.map(d => d.count);
        
        levelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '用户数量',
                    data: data,
                    backgroundColor: [
                        '#1976d2',
                        '#388e3c',
                        '#f57c00',
                        '#c2185b',
                        '#7b1fa2'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
        
        console.log('✅ 图表绘制成功');
    } catch (error) {
        console.error('绘制图表失败:', error);
    }
}

// 初始化标签页
function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            switchTab(tabName);
        });
    });
}

// 切换标签页
function switchTab(tabName) {
    // 更新标签状态
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    
    // 更新内容
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // 加载对应内容
    switch(tabName) {
        case 'users':
            loadUsers();
            break;
        case 'levels':
            loadLevelConfig();
            break;
        case 'rewards':
            loadRewardsConfig();
            break;
        case 'badges':
            loadBadges();
            break;
        case 'broadcast':
            loadBroadcastConfig();
            break;
        case 'groups':
            loadGroups();
            break;
        case 'data':
            loadDataManagement();
            break;
    }
}

// 加载初始数据
async function loadInitialData() {
    try {
        // 加载群组列表
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            const groups = result.data;
            
            // 更新群组选择器
            const selectors = ['levelGroupSelect', 'sourceGroup'];
            selectors.forEach(id => {
                const select = document.getElementById(id);
                if (select) {
                    select.innerHTML = groups.map(g => 
                        `<option value="${g.group_id}">${g.group_name || g.group_id}</option>`
                    ).join('');
                }
            });
            
            // 保存群组配置
            groups.forEach(g => {
                groupConfigs[g.group_id] = g;
            });
        }
    } catch (error) {
        console.error('加载初始数据失败:', error);
    }
}

// 加载用户列表
async function loadUsers(page = 1) {
    try {
        const offset = (page - 1) * pageSize;
        const response = await fetch(`/api/level/users?limit=${pageSize}&offset=${offset}`);
        const result = await response.json();
        
        if (result.success) {
            allUsers = result.data.users;
            renderUserTable(allUsers);
            renderPagination(result.data.total, page);
        }
    } catch (error) {
        console.error('加载用户列表失败:', error);
        showError('加载用户列表失败');
    }
}

// 渲染用户表格
function renderUserTable(users) {
    const tbody = document.getElementById('userTableBody');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">暂无数据</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.user_id}</td>
            <td>${user.display_name}</td>
            <td><span class="level-badge level-${user.level}">Lv.${user.level}</span></td>
            <td>${user.total_exp}</td>
            <td>${user.available_points}</td>
            <td>${user.user_eval_count}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-sm btn-primary" onclick="editUser('${user.user_id}')">编辑</button>
                    <button class="btn-sm btn-success" onclick="viewUserBadges('${user.user_id}')">勋章</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// 渲染分页
function renderPagination(total, currentPage) {
    const totalPages = Math.ceil(total / pageSize);
    const pagination = document.getElementById('userPagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '<div style="text-align: center; margin-top: 20px;">';
    
    // 上一页
    if (currentPage > 1) {
        html += `<button onclick="loadUsers(${currentPage - 1})">上一页</button> `;
    }
    
    // 页码
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            html += `<span style="margin: 0 5px; font-weight: bold;">${i}</span> `;
        } else {
            html += `<button onclick="loadUsers(${i})">${i}</button> `;
        }
    }
    
    // 下一页
    if (currentPage < totalPages) {
        html += ` <button onclick="loadUsers(${currentPage + 1})">下一页</button>`;
    }
    
    html += '</div>';
    pagination.innerHTML = html;
}

// 初始化搜索
function initSearch() {
    const searchInput = document.getElementById('userSearch');
    let searchTimer;
    
    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const keyword = this.value.trim();
            if (keyword) {
                const filtered = allUsers.filter(user => 
                    user.user_id.includes(keyword) || 
                    user.display_name.toLowerCase().includes(keyword.toLowerCase())
                );
                renderUserTable(filtered);
            } else {
                renderUserTable(allUsers);
            }
        }, 300);
    });
}

// 编辑用户
async function editUser(userId) {
    const user = allUsers.find(u => u.user_id === userId);
    if (!user) return;
    
    // 填充表单
    document.getElementById('editUserId').value = user.user_id;
    document.getElementById('editDisplayName').value = user.display_name;
    document.getElementById('editLevel').value = user.level;
    document.getElementById('editExp').value = '';
    document.getElementById('editPoints').value = '';
    
    // 显示模态框
    document.getElementById('editUserModal').style.display = 'block';
}

// 保存用户编辑
async function saveUserEdit() {
    const userId = document.getElementById('editUserId').value;
    const data = {
        displayName: document.getElementById('editDisplayName').value,
        level: parseInt(document.getElementById('editLevel').value),
        exp: parseInt(document.getElementById('editExp').value) || 0,
        points: parseInt(document.getElementById('editPoints').value) || 0
    };
    
    try {
        const response = await fetch(`/api/level/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('用户信息更新成功');
            closeModal('editUserModal');
            loadUsers(currentPage);
            loadStats(); // 重新加载统计数据
        } else {
            showError(result.error || '更新失败');
        }
    } catch (error) {
        console.error('保存用户编辑失败:', error);
        showError('保存失败');
    }
}

// 查看用户勋章
async function viewUserBadges(userId) {
    try {
        const response = await fetch(`/api/level/users/${userId}`);
        const result = await response.json();
        
        if (result.success) {
            const userInfo = result.data;
            // TODO: 显示用户勋章详情
            alert(`用户 ${userInfo.profile.display_name} 的勋章功能开发中...`);
        }
    } catch (error) {
        console.error('获取用户勋章失败:', error);
    }
}

// 加载勋章列表
async function loadBadges() {
    try {
        const response = await fetch('/api/level/badges');
        const result = await response.json();
        
        if (result.success) {
            allBadges = result.data;
            renderBadgesList(allBadges);
        }
    } catch (error) {
        console.error('加载勋章列表失败:', error);
        showError('加载勋章列表失败');
    }
}

// 渲染勋章列表
function renderBadgesList(badges) {
    const container = document.getElementById('badgesList');
    
    if (badges.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">暂无勋章</div>';
        return;
    }
    
    // 按稀有度分组
    const grouped = {
        mythic: [],
        legendary: [],
        epic: [],
        rare: [],
        common: []
    };
    
    badges.forEach(badge => {
        if (grouped[badge.rarity]) {
            grouped[badge.rarity].push(badge);
        }
    });
    
    let html = '';
    
    const rarityNames = {
        mythic: '神话',
        legendary: '传说',
        epic: '史诗',
        rare: '稀有',
        common: '普通'
    };
    
    for (const [rarity, badgeList] of Object.entries(grouped)) {
        if (badgeList.length === 0) continue;
        
        html += `<div style="margin-bottom: 30px;">`;
        html += `<h3>${rarityNames[rarity]}</h3>`;
        html += `<div>`;
        
        badgeList.forEach(badge => {
            html += `<span class="badge-item badge-rarity-${rarity}">`;
            html += `${badge.badge_emoji} ${badge.badge_name}`;
            html += `</span>`;
        });
        
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
}

// 显示创建勋章模态框
function showCreateBadgeModal() {
    const modal = document.getElementById('createBadgeModal');
    modal.style.display = 'block';
    updateConditionForm();
}

// 更新条件表单
function updateConditionForm() {
    const type = document.getElementById('badgeConditionType').value;
    const container = document.getElementById('conditionDetails');
    
    switch(type) {
        case 'stat_based':
            container.innerHTML = `
                <div class="form-group">
                    <label>统计字段：</label>
                    <select id="conditionField">
                        <option value="total_exp">总经验值</option>
                        <option value="available_points">可用积分</option>
                        <option value="total_points_earned">累计获得积分</option>
                        <option value="attack_count">出击次数</option>
                        <option value="user_eval_count">用户评价次数</option>
                        <option value="level">等级</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>目标值：</label>
                    <input type="number" id="conditionTarget" placeholder="例如：100">
                </div>
            `;
            break;
            
        case 'evaluation_streak':
            container.innerHTML = `
                <div class="form-group">
                    <label>评价类型：</label>
                    <select id="streakType">
                        <option value="perfect_score">满分评价</option>
                        <option value="high_score">高分评价（8分以上）</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>连续次数：</label>
                    <input type="number" id="streakCount" placeholder="例如：10">
                </div>
            `;
            break;
            
        case 'manual':
            container.innerHTML = `
                <div class="info-box">
                    此勋章只能由管理员手动授予
                </div>
            `;
            break;
    }
}

// 创建勋章
async function createBadge() {
    const type = document.getElementById('badgeConditionType').value;
    let unlockConditions = {};
    
    switch(type) {
        case 'stat_based':
            unlockConditions = {
                type: 'stat_based',
                field: document.getElementById('conditionField').value,
                operator: '>=',
                target: parseInt(document.getElementById('conditionTarget').value)
            };
            break;
            
        case 'evaluation_streak':
            unlockConditions = {
                type: 'evaluation_streak',
                streak_type: document.getElementById('streakType').value,
                count: parseInt(document.getElementById('streakCount').value),
                consecutive: true
            };
            break;
            
        case 'manual':
            unlockConditions = {
                type: 'manual',
                desc: '仅管理员可授予'
            };
            break;
    }
    
    const badgeData = {
        badge_id: document.getElementById('newBadgeId').value,
        badge_name: document.getElementById('newBadgeName').value,
        badge_emoji: document.getElementById('newBadgeEmoji').value || '🏆',
        badge_desc: document.getElementById('newBadgeDesc').value,
        badge_type: type === 'manual' ? 'manual' : 'auto',
        rarity: document.getElementById('newBadgeRarity').value,
        unlock_conditions: JSON.stringify(unlockConditions),
        group_id: currentGroupId
    };
    
    try {
        const response = await fetch('/api/level/badges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(badgeData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('勋章创建成功');
            closeModal('createBadgeModal');
            loadBadges();
        } else {
            showError(result.error || '创建失败');
        }
    } catch (error) {
        console.error('创建勋章失败:', error);
        showError('创建失败');
    }
}

// 加载系统配置
async function loadConfig() {
    try {
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            renderConfig(result.data);
        }
    } catch (error) {
        console.error('加载系统配置失败:', error);
        showError('加载系统配置失败');
    }
}

// 渲染系统配置
function renderConfig(configs) {
    const container = document.getElementById('configContent');
    
    if (configs.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">暂无配置</div>';
        return;
    }
    
    // 简化显示，只显示默认配置
    const defaultConfig = configs.find(c => c.group_id === 'default') || configs[0];
    
    if (!defaultConfig) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">配置加载失败</div>';
        return;
    }
    
    const levelConfig = JSON.parse(defaultConfig.level_config || '{}');
    const pointsConfig = JSON.parse(defaultConfig.points_config || '{}');
    
    let html = '<div style="background: white; padding: 20px; border-radius: 8px;">';
    html += '<h3>等级配置</h3>';
    html += '<table class="user-table" style="margin-bottom: 30px;">';
    html += '<thead><tr><th>等级</th><th>名称</th><th>所需经验</th><th>所需评价次数</th></tr></thead>';
    html += '<tbody>';
    
    if (levelConfig.levels) {
        levelConfig.levels.forEach(level => {
            html += `<tr>`;
            html += `<td>Lv.${level.level}</td>`;
            html += `<td>${level.name}</td>`;
            html += `<td>${level.required_exp}</td>`;
            html += `<td>${level.required_evals}</td>`;
            html += `</tr>`;
        });
    }
    
    html += '</tbody></table>';
    
    html += '<h3>奖励配置</h3>';
    html += '<table class="user-table">';
    html += '<thead><tr><th>行为</th><th>经验奖励</th><th>积分奖励</th><th>描述</th></tr></thead>';
    html += '<tbody>';
    
    if (pointsConfig.base_rewards) {
        Object.entries(pointsConfig.base_rewards).forEach(([action, reward]) => {
            html += `<tr>`;
            html += `<td>${action}</td>`;
            html += `<td>${reward.exp || 0}</td>`;
            html += `<td>${reward.points || 0}</td>`;
            html += `<td>${reward.desc || '-'}</td>`;
            html += `</tr>`;
        });
    }
    
    html += '</tbody></table>';
    html += '</div>';
    
    container.innerHTML = html;
}

// 更新排行榜
function updateRanking(topUsers) {
    const tbody = document.getElementById('rankingTableBody');
    
    if (topUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">暂无数据</td></tr>';
        return;
    }
    
    tbody.innerHTML = topUsers.map((user, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        
        return `
            <tr>
                <td>${medal}</td>
                <td>${user.display_name}</td>
                <td><span class="level-badge level-${user.level}">Lv.${user.level}</span></td>
                <td>${user.total_exp}</td>
                <td>${user.user_eval_count}</td>
            </tr>
        `;
    }).join('');
}

// 关闭模态框
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// 显示错误消息
function showError(message) {
    showMessage(message, 'error');
}

// 显示成功消息
function showSuccess(message) {
    showMessage(message, 'success');
}

// 显示消息
function showMessage(message, type) {
    const container = document.getElementById('messageContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.textContent = message;
    messageDiv.style.position = 'fixed';
    messageDiv.style.top = '20px';
    messageDiv.style.right = '20px';
    messageDiv.style.zIndex = '9999';
    
    container.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// 点击模态框外部关闭
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};

// 将函数暴露到全局作用域
window.editUser = editUser;
window.viewUserBadges = viewUserBadges;
window.showCreateBadgeModal = showCreateBadgeModal;
window.createBadge = createBadge;
window.closeModal = closeModal;
window.saveUserEdit = saveUserEdit;
window.loadUsers = loadUsers;
window.switchTab = switchTab;

// 导出配置管理函数
window.removeLevelRow = removeLevelRow;
window.updateLevelField = updateLevelField;
window.addLevelRow = addLevelRow;
window.saveLevelConfig = saveLevelConfig;
window.resetLevelConfig = resetLevelConfig;
window.saveRewardsConfig = saveRewardsConfig;
window.saveBroadcastConfig = saveBroadcastConfig;
window.insertVariable = insertVariable;
window.testBroadcast = testBroadcast;
window.updateConditionForm = updateConditionForm;
window.createBadge = createBadge;
window.showCreateBadgeModal = showCreateBadgeModal;
window.showCreateGroupModal = showCreateGroupModal;
window.createGroup = createGroup;
window.editGroupConfig = editGroupConfig;
window.deleteGroup = deleteGroup;
window.exportData = exportData;
window.showImportModal = showImportModal;
window.importData = importData;
window.showMigrateModal = showMigrateModal;
window.migrateData = migrateData;

  // 导出其他缺失的函数
  window.toggleLevelSystem = toggleLevelSystem;
  window.searchUser = searchUser;
  window.createNewGroup = createNewGroup;
  window.exportAllData = exportAllData;
  window.exportUserData = exportUserData;
  window.exportConfig = exportConfig;
  window.migrateGroup = migrateGroup;
  window.adjustUserData = adjustUserData;
  window.awardBadge = awardBadge;
  window.loadGroups = loadGroups;

// ==================== 缺失的配置管理函数 ====================

// 删除等级行
function removeLevelRow(index) {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    const config = groupConfigs[groupId];
    
    if (!config) return;
    
    const levelConfig = JSON.parse(config.level_config || '{}');
    if (!levelConfig.levels) return;
    
    levelConfig.levels.splice(index, 1);
    
    // 重新编号
    levelConfig.levels.forEach((level, idx) => {
        level.level = idx + 1;
    });
    
    config.level_config = JSON.stringify(levelConfig);
    renderLevelConfig(levelConfig.levels);
}

// 更新等级字段
function updateLevelField(index, field, value) {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    const config = groupConfigs[groupId];
    
    if (!config) return;
    
    const levelConfig = JSON.parse(config.level_config || '{}');
    if (!levelConfig.levels || !levelConfig.levels[index]) return;
    
    levelConfig.levels[index][field] = value;
    config.level_config = JSON.stringify(levelConfig);
}

// 添加等级行
function addLevelRow() {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    let config = groupConfigs[groupId];
    
    if (!config) {
        config = {
            group_id: groupId,
            level_config: JSON.stringify({ levels: [] })
        };
        groupConfigs[groupId] = config;
    }
    
    const levelConfig = JSON.parse(config.level_config || '{}');
    if (!levelConfig.levels) {
        levelConfig.levels = [];
    }
    
    const newLevel = {
        level: levelConfig.levels.length + 1,
        name: `等级${levelConfig.levels.length + 1}`,
        required_exp: (levelConfig.levels.length + 1) * 100,
        required_evals: (levelConfig.levels.length + 1) * 5
    };
    
    levelConfig.levels.push(newLevel);
    config.level_config = JSON.stringify(levelConfig);
    
    renderLevelConfig(levelConfig.levels);
}

// 保存等级配置
async function saveLevelConfig() {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    const config = groupConfigs[groupId];
    
    if (!config) {
        showError('没有配置可保存');
        return;
    }
    
    try {
        const response = await fetch('/api/level/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: groupId,
                levelConfig: JSON.parse(config.level_config || '{}')
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('等级配置保存成功');
        } else {
            showError(result.error || '保存失败');
        }
    } catch (error) {
        console.error('保存等级配置失败:', error);
        showError('保存失败');
    }
}

// 重置等级配置
function resetLevelConfig() {
    if (!confirm('确定要重置为默认配置吗？')) return;
    
    const defaultLevels = [
        { level: 1, name: "新手勇士 🟢", required_exp: 0, required_evals: 0 },
        { level: 2, name: "初级勇士 🔵", required_exp: 50, required_evals: 3 },
        { level: 3, name: "中级勇士 🟣", required_exp: 150, required_evals: 8 },
        { level: 4, name: "高级勇士 🟠", required_exp: 300, required_evals: 15 },
        { level: 5, name: "专家勇士 🔴", required_exp: 500, required_evals: 25 }
    ];
    
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    groupConfigs[groupId] = {
        group_id: groupId,
        level_config: JSON.stringify({ levels: defaultLevels })
    };
    
    renderLevelConfig(defaultLevels);
}

// 渲染等级配置
function renderLevelConfig(levels) {
    const tbody = document.getElementById('levelConfigBody');
    
    if (!levels || levels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">暂无等级配置</td></tr>';
        return;
    }
    
    tbody.innerHTML = levels.map((level, index) => `
        <tr>
            <td>Lv.${level.level}</td>
            <td><input type="text" value="${level.name}" onchange="updateLevelField(${index}, 'name', this.value)"></td>
            <td><input type="number" value="${level.required_exp}" onchange="updateLevelField(${index}, 'required_exp', parseInt(this.value))"></td>
            <td><input type="number" value="${level.required_evals}" onchange="updateLevelField(${index}, 'required_evals', parseInt(this.value))"></td>
            <td><button class="btn btn-danger" onclick="removeLevelRow(${index})">删除</button></td>
        </tr>
    `).join('');
}

// 加载群组等级配置
async function loadGroupLevelConfig() {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    
    try {
        const response = await fetch(`/api/level/config?groupId=${groupId}`);
        const result = await response.json();
        
        if (result.success && result.data) {
            const levelConfig = result.data.levels || [];
            groupConfigs[groupId] = {
                group_id: groupId,
                level_config: JSON.stringify({ levels: levelConfig })
            };
            renderLevelConfig(levelConfig);
        }
    } catch (error) {
        console.error('加载群组等级配置失败:', error);
    }
}

// 保存奖励配置
async function saveRewardsConfig() {
    const rewardsData = {
        attack: {
            exp: parseInt(document.getElementById('attackExp').value) || 20,
            points: parseInt(document.getElementById('attackPoints').value) || 10
        },
        user_eval: {
            exp: parseInt(document.getElementById('userEvalExp').value) || 30,
            points: parseInt(document.getElementById('userEvalPoints').value) || 25
        },
        merchant_eval: {
            exp: parseInt(document.getElementById('merchantEvalExp').value) || 25,
            points: parseInt(document.getElementById('merchantEvalPoints').value) || 20
        },
        text_eval: {
            exp: parseInt(document.getElementById('textEvalExp').value) || 15,
            points: parseInt(document.getElementById('textEvalPoints').value) || 15
        },
        perfect_score: {
            exp: parseInt(document.getElementById('perfectScoreExp').value) || 50,
            points: parseInt(document.getElementById('perfectScorePoints').value) || 100
        },
        level_up: {
            points: parseInt(document.getElementById('levelUpPoints').value) || 50
        },
        multipliers: {
            exp: parseFloat(document.getElementById('expMultiplier').value) || 1.0,
            points: parseFloat(document.getElementById('pointsMultiplier').value) || 1.0,
            weekend: parseFloat(document.getElementById('weekendBonus').value) || 1.2
        }
    };
    
    try {
        const response = await fetch('/api/level/rewards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: currentGroupId,
                rewards: rewardsData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('奖励配置保存成功');
        } else {
            showError(result.error || '保存失败');
        }
    } catch (error) {
        console.error('保存奖励配置失败:', error);
        showError('保存失败');
    }
}

// 保存播报配置
async function saveBroadcastConfig() {
    const broadcastData = {
        enabled: {
            levelUp: document.getElementById('enableLevelUp').checked,
            badgeUnlock: document.getElementById('enableBadgeUnlock').checked,
            milestone: document.getElementById('enableMilestone').checked,
            perfectScore: document.getElementById('enablePerfectScore').checked
        },
        templates: {
            levelUp: document.getElementById('levelUpTemplate').value,
            badgeUnlock: document.getElementById('badgeUnlockTemplate').value
        }
    };
    
    try {
        const response = await fetch('/api/level/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: currentGroupId,
                broadcast: broadcastData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('播报配置保存成功');
        } else {
            showError(result.error || '保存失败');
        }
    } catch (error) {
        console.error('保存播报配置失败:', error);
        showError('保存失败');
    }
}

// 插入变量
function insertVariable(textareaId, variable) {
    const textarea = document.getElementById(textareaId);
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    
    textarea.value = text.substring(0, start) + variable + text.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + variable.length, start + variable.length);
}

// 测试播报
async function testBroadcast() {
    const template = document.getElementById('levelUpTemplate').value;
    const testData = {
        user_name: '测试用户',
        old_level: 1,
        new_level: 2,
        level_name: '初级勇士 🔵',
        level_up_points: 50
    };
    
    let preview = template;
    for (const [key, value] of Object.entries(testData)) {
        preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    
    alert('播报预览：\n\n' + preview);
}

// 加载群组列表
async function loadGroups() {
    try {
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            renderGroupsTable(result.data);
        }
    } catch (error) {
        console.error('加载群组列表失败:', error);
        showError('加载群组列表失败');
    }
}

// 渲染群组表格
function renderGroupsTable(groups) {
    const tbody = document.getElementById('groupsTableBody');
    
    if (!groups || groups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">暂无群组</td></tr>';
        return;
    }
    
    tbody.innerHTML = groups.map(group => `
        <tr>
            <td>${group.group_id}</td>
            <td>${group.group_name || '未命名'}</td>
            <td>-</td>
            <td><span class="status-enabled">活跃</span></td>
            <td>
                <button class="btn btn-primary" onclick="editGroupConfig('${group.group_id}')">配置</button>
                <button class="btn btn-danger" onclick="deleteGroup('${group.group_id}')">删除</button>
            </td>
        </tr>
    `).join('');
}

// 显示创建群组模态框
function showCreateGroupModal() {
    const modal = document.getElementById('createGroupModal');
    modal.style.display = 'block';
}

// 创建群组
async function createGroup() {
    const groupId = document.getElementById('newGroupId').value.trim();
    const groupName = document.getElementById('newGroupName').value.trim();
    
    if (!groupId) {
        showError('群组ID不能为空');
        return;
    }
    
    try {
        const response = await fetch('/api/level/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: groupId,
                group_name: groupName || groupId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('群组创建成功');
            closeModal('createGroupModal');
            loadGroups(); // 重新加载群组列表
        } else {
            showError('创建失败：' + result.error);
        }
    } catch (error) {
        console.error('创建群组失败:', error);
        showError('创建失败');
    }
}

// 编辑群组配置
function editGroupConfig(groupId) {
    currentGroupId = groupId;
    switchTab('levels');
}

// 删除群组
async function deleteGroup(groupId) {
    if (!confirm(`确定要删除群组 ${groupId} 吗？此操作不可恢复！`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/level/groups/${groupId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('群组删除成功');
            loadGroups();
        } else {
            showError('删除失败：' + result.error);
        }
    } catch (error) {
        console.error('删除群组失败:', error);
        showError('删除失败');
    }
}

// 加载数据管理
async function loadDataManagement() {
    // 加载群组选择框
    try {
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            const sourceGroupSelect = document.getElementById('sourceGroup');
            if (sourceGroupSelect) {
                sourceGroupSelect.innerHTML = '<option value="">选择源群组</option>' + 
                    result.data.map(group => 
                        `<option value="${group.group_id}">${group.group_name || group.group_id}</option>`
                    ).join('');
            }
        }
    } catch (error) {
        console.error('加载数据管理失败:', error);
    }
}

// 导出数据
async function exportData() {
    const exportType = document.getElementById('exportType').value;
    const groupId = document.getElementById('exportGroup').value || 'all';
    
    try {
        const response = await fetch('/api/level/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: exportType,
                groupId: groupId
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `level_system_export_${exportType}_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showSuccess('数据导出成功');
        } else {
            showError('导出失败');
        }
    } catch (error) {
        console.error('导出数据失败:', error);
        showError('导出失败');
    }
}

// 显示导入模态框
function showImportModal() {
    document.getElementById('importModal').style.display = 'block';
}

// 导入数据
async function importData() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showError('请选择要导入的文件');
        return;
    }
    
    if (!confirm('导入数据将覆盖现有数据，确定继续吗？')) {
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/level/import', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('数据导入成功');
            loadInitialData(); // 重新加载所有数据
        } else {
            showError('导入失败：' + result.error);
        }
    } catch (error) {
        console.error('导入数据失败:', error);
        showError('导入失败');
    }
}

// 显示迁移模态框
function showMigrateModal() {
    document.getElementById('migrateModal').style.display = 'block';
}

// 执行数据迁移
async function migrateData() {
    const sourceGroup = document.getElementById('sourceGroup').value;
    const targetGroup = document.getElementById('targetGroup').value;
    const migrateUsers = document.getElementById('migrateUsers').checked;
    const migrateBadges = document.getElementById('migrateBadges').checked;
    const migrateConfig = document.getElementById('migrateConfig').checked;
    
    if (sourceGroup === targetGroup) {
        showError('源群组和目标群组不能相同');
        return;
    }
    
    try {
        const response = await fetch('/api/level/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceGroup,
                targetGroup,
                options: {
                    users: migrateUsers,
                    badges: migrateBadges,
                    config: migrateConfig
                }
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('数据迁移成功');
            closeModal('migrateModal');
        } else {
            showError(result.error || '迁移失败');
        }
    } catch (error) {
        console.error('数据迁移失败:', error);
        showError('迁移失败');
    }
}

// ==================== 额外的功能函数 ====================

// 切换等级系统状态
async function toggleLevelSystem() {
    try {
        const response = await fetch('/api/level/toggle', {
            method: 'POST'
        });
        const result = await response.json();
        
        if (result.success) {
            showSuccess(`等级系统已${result.enabled ? '启用' : '禁用'}`);
            checkLevelSystemStatus();
        } else {
            showError('切换状态失败');
        }
    } catch (error) {
        console.error('切换等级系统状态失败:', error);
        showError('切换状态失败');
    }
}

// 搜索用户
async function searchUser() {
    const searchTerm = document.getElementById('userSearchInput').value.trim();
    if (!searchTerm) {
        showError('请输入搜索关键词');
        return;
    }
    
    try {
        const response = await fetch('/api/level/users?search=' + encodeURIComponent(searchTerm));
        const result = await response.json();
        
        if (result.success) {
            const searchResult = document.getElementById('userSearchResult');
            if (result.data.users.length > 0) {
                searchResult.innerHTML = `
                    <h3>搜索结果：</h3>
                    <table class="config-table">
                        <thead>
                            <tr><th>用户ID</th><th>显示名</th><th>等级</th><th>经验值</th><th>积分</th><th>操作</th></tr>
                        </thead>
                        <tbody>
                            ${result.data.users.map(user => `
                                <tr>
                                    <td>${user.user_id}</td>
                                    <td>${user.display_name}</td>
                                    <td>Lv.${user.level}</td>
                                    <td>${user.total_exp}</td>
                                    <td>${user.available_points}</td>
                                    <td>
                                        <button class="btn btn-primary" onclick="editUser('${user.user_id}')">编辑</button>
                                        <button class="btn btn-success" onclick="viewUserBadges('${user.user_id}')">勋章</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
                searchResult.style.display = 'block';
            } else {
                searchResult.innerHTML = '<p>未找到匹配的用户</p>';
                searchResult.style.display = 'block';
            }
        } else {
            showError('搜索失败：' + result.error);
        }
    } catch (error) {
        console.error('搜索用户失败:', error);
        showError('搜索失败');
    }
}

// 创建新群组（简化版）
function createNewGroup() {
    showCreateGroupModal();
}

// 导出完整数据
async function exportAllData() {
    await exportData('all');
}

// 导出用户数据
async function exportUserData() {
    await exportData('users');
}

// 导出配置
async function exportConfig() {
    await exportData('config');
}

// 群组迁移
async function migrateGroup() {
    const sourceGroup = document.getElementById('sourceGroup').value;
    const targetGroupId = document.getElementById('targetGroupId').value.trim();
    
    if (!sourceGroup || !targetGroupId) {
        showError('请选择源群组和输入目标群组ID');
        return;
    }
    
    if (!confirm(`确定要将 ${sourceGroup} 的数据迁移到 ${targetGroupId} 吗？`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/level/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceGroupId: sourceGroup,
                targetGroupId: targetGroupId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('群组迁移成功');
        } else {
            showError('迁移失败：' + result.error);
        }
    } catch (error) {
        console.error('群组迁移失败:', error);
        showError('迁移失败');
    }
}

// 调整用户数据
async function adjustUserData() {
    const expAdjust = parseInt(document.getElementById('adjustExp').value) || 0;
    const pointsAdjust = parseInt(document.getElementById('adjustPoints').value) || 0;
    const reason = document.getElementById('adjustReason').value.trim();
    
    if (expAdjust === 0 && pointsAdjust === 0) {
        showError('请输入调整数值');
        return;
    }
    
    if (!reason) {
        showError('请输入调整原因');
        return;
    }
    
    try {
        const response = await fetch(`/api/level/users/${currentUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                exp: expAdjust,
                points: pointsAdjust,
                reason: reason
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('用户数据调整成功');
            closeModal('userDetailModal');
            loadUsers(); // 重新加载用户列表
        } else {
            showError('调整失败：' + result.error);
        }
    } catch (error) {
        console.error('调整用户数据失败:', error);
        showError('调整失败');
    }
}

// 授予勋章
async function awardBadge() {
    const badgeId = document.getElementById('awardBadgeSelect').value;
    
    if (!badgeId) {
        showError('请选择要授予的勋章');
        return;
    }
    
    try {
        const response = await fetch('/api/level/badges/grant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUserId,
                badgeId: badgeId,
                groupId: currentGroupId
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('勋章授予成功');
        } else {
            showError('授予失败：' + result.error);
        }
    } catch (error) {
        console.error('授予勋章失败:', error);
        showError('授予失败');
    }
}

// 加载等级配置
async function loadLevelConfig() {
    try {
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            // 填充群组选择框
            const groupSelect = document.getElementById('levelGroupSelect');
            groupSelect.innerHTML = result.data.map(group => 
                `<option value="${group.group_id}">${group.group_name || group.group_id}</option>`
            ).join('');
            
            // 加载当前群组的配置
            loadGroupLevelConfig();
        }
    } catch (error) {
        console.error('加载等级配置失败:', error);
        showError('加载等级配置失败');
    }
}

// 加载群组等级配置
async function loadGroupLevelConfig() {
    const groupId = document.getElementById('levelGroupSelect').value || 'default';
    
    try {
        const response = await fetch(`/api/level/groups/${groupId}`);
        const result = await response.json();
        
        if (result.success) {
            const levelConfig = JSON.parse(result.data.level_config || '{}');
            groupConfigs[groupId] = result.data;
            
            if (levelConfig.levels) {
                renderLevelConfig(levelConfig.levels);
            } else {
                renderLevelConfig([]);
            }
        }
    } catch (error) {
        console.error('加载群组等级配置失败:', error);
        showError('加载群组等级配置失败');
    }
}

// 加载奖励配置
async function loadRewardsConfig() {
    const groupId = currentGroupId || 'default';
    
    try {
        const response = await fetch(`/api/level/rewards?groupId=${groupId}`);
        const result = await response.json();
        
        if (result.success) {
            const config = result.data;
            
            // 填充表单
            if (config.base_rewards) {
                document.getElementById('attackExp').value = config.base_rewards.attack?.exp || 20;
                document.getElementById('attackPoints').value = config.base_rewards.attack?.points || 10;
                document.getElementById('userEvalExp').value = config.base_rewards.user_eval_12?.exp || 30;
                document.getElementById('userEvalPoints').value = config.base_rewards.user_eval_12?.points || 25;
                document.getElementById('merchantEvalExp').value = config.base_rewards.merchant_eval?.exp || 25;
                document.getElementById('merchantEvalPoints').value = config.base_rewards.merchant_eval?.points || 20;
                document.getElementById('textEvalExp').value = config.base_rewards.text_eval?.exp || 15;
                document.getElementById('textEvalPoints').value = config.base_rewards.text_eval?.points || 15;
            }
            
            if (config.special_rewards) {
                document.getElementById('perfectScoreExp').value = config.special_rewards.perfect_score?.exp || 50;
                document.getElementById('perfectScorePoints').value = config.special_rewards.perfect_score?.points || 100;
                document.getElementById('levelUpPoints').value = config.special_rewards.level_up_bonus?.points || 50;
            }
            
            if (config.multipliers) {
                document.getElementById('expMultiplier').value = config.multipliers.exp_multiplier || 1.0;
                document.getElementById('pointsMultiplier').value = config.multipliers.points_multiplier || 1.0;
                document.getElementById('weekendBonus').value = config.multipliers.weekend_bonus || 1.2;
            }
        }
    } catch (error) {
        console.error('加载奖励配置失败:', error);
        showError('加载奖励配置失败');
    }
}

// 加载播报配置
async function loadBroadcastConfig() {
    const groupId = currentGroupId || 'default';
    
    try {
        const response = await fetch(`/api/level/broadcast?groupId=${groupId}`);
        const result = await response.json();
        
        if (result.success) {
            const config = result.data;
            
            // 填充开关
            document.getElementById('enableLevelUp').checked = config.enable_level_up !== false;
            document.getElementById('enableBadgeUnlock').checked = config.enable_badge_unlock !== false;
            document.getElementById('enableMilestone').checked = config.enable_milestone || false;
            document.getElementById('enablePerfectScore').checked = config.enable_perfect_score || false;
            
            // 填充模板
            document.getElementById('levelUpTemplate').value = config.level_up_template || 
                '🎉 恭喜 {{user_name}} 升级了！\\n⭐ Lv.{{old_level}} → Lv.{{new_level}} {{level_name}}\\n💎 升级奖励：{{level_up_points}}积分\\n继续努力，成为传说勇士！💪';
            
            document.getElementById('badgeUnlockTemplate').value = config.badge_unlock_template || 
                '🏆 {{user_name}} 解锁了新勋章！\\n{{badge_emoji}} {{badge_name}}\\n{{badge_desc}}';
        }
    } catch (error) {
        console.error('加载播报配置失败:', error);
        showError('加载播报配置失败');
    }
}

// 保存播报配置
async function saveBroadcastConfig() {
    const broadcastData = {
        enable_level_up: document.getElementById('enableLevelUp').checked,
        enable_badge_unlock: document.getElementById('enableBadgeUnlock').checked,
        enable_milestone: document.getElementById('enableMilestone').checked,
        enable_perfect_score: document.getElementById('enablePerfectScore').checked,
        level_up_template: document.getElementById('levelUpTemplate').value,
        badge_unlock_template: document.getElementById('badgeUnlockTemplate').value
    };
    
    try {
        const response = await fetch('/api/level/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: currentGroupId,
                broadcast: broadcastData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('播报配置保存成功');
        } else {
            showError(result.error || '保存失败');
        }
    } catch (error) {
        console.error('保存播报配置失败:', error);
        showError('保存失败');
    }
}

// 插入变量到模板
function insertVariable(templateId, variable) {
    const textarea = document.getElementById(templateId);
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(textarea.selectionEnd);
    
    textarea.value = textBefore + variable + textAfter;
    textarea.focus();
    textarea.setSelectionRange(cursorPos + variable.length, cursorPos + variable.length);
}

// 测试播报
async function testBroadcast() {
    const template = document.getElementById('levelUpTemplate').value;
    const testData = {
        user_name: '测试用户',
        old_level: 1,
        new_level: 2,
        level_name: '初级勇士 🔵',
        level_up_points: 50
    };
    
    let preview = template;
    Object.keys(testData).forEach(key => {
        preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), testData[key]);
    });
    
    alert('播报预览：\\n\\n' + preview);
}

// 加载勋章列表
async function loadBadges() {
    try {
        const response = await fetch('/api/level/badges');
        const result = await response.json();
        
        if (result.success) {
            renderBadgesList(result.data);
        } else {
            showError('加载勋章失败：' + result.error);
        }
    } catch (error) {
        console.error('加载勋章失败:', error);
        showError('加载勋章失败');
    }
}

// 渲染勋章列表
function renderBadgesList(badges) {
    const container = document.getElementById('badgesList');
    
    if (!badges || badges.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px;">暂无勋章</div>';
        return;
    }
    
    container.innerHTML = badges.map(badge => `
        <div class="badge-item badge-rarity-${badge.rarity}">
            <span style="font-size: 24px;">${badge.badge_emoji}</span>
            <h4>${badge.badge_name}</h4>
            <p>${badge.badge_desc}</p>
            <small>稀有度: ${badge.rarity}</small>
        </div>
    `).join('');
}

// 加载数据管理界面
async function loadDataManagement() {
    // 加载群组选择框
    try {
        const response = await fetch('/api/level/groups');
        const result = await response.json();
        
        if (result.success) {
            const sourceGroupSelect = document.getElementById('sourceGroup');
            if (sourceGroupSelect) {
                sourceGroupSelect.innerHTML = '<option value="">选择源群组</option>' + 
                    result.data.map(group => 
                        `<option value="${group.group_id}">${group.group_name || group.group_id}</option>`
                    ).join('');
            }
        }
    } catch (error) {
        console.error('加载数据管理失败:', error);
    }
} 