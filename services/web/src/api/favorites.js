// =====================================================
// api/favorites.js —— 工具收藏接口（账号级，需登录）
// =====================================================
import client from './client'

// 收藏的工具（完整字段，供 ToolCard 展示）
export const listFavorites = () => client.get('/favorites').then(r => r.data)

// 收藏的工具 id 列表（轻量，首页标记星标用）
export const listFavoriteIds = () => client.get('/favorites/ids').then(r => r.data)

// 切换收藏，返回 { favorited: boolean }
export const toggleFavorite = (toolId) => client.post(`/favorites/${toolId}`).then(r => r.data)
