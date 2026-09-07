// =====================================================
// api/games.js —— 游戏中心相关接口
// 职责：获取玩家战绩档案、上报对局结果
// =====================================================

import api from './client'

// 获取当前用户的游戏档案（各棋类的胜负场次等）：GET /api/games/profile
export const getGameProfile = () => api.get('/api/games/profile').then(r => r.data)

// 上报对局结果：POST /api/games/record
// gameType: 'gomoku' | 'chess'
// mode: 'pvp' | 'pve'
// won: true / false
export const recordResult = (gameType, mode, won) =>
  api.post('/api/games/record', { gameType, mode, won })
