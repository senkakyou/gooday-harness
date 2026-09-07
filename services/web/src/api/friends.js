// =====================================================
// api/friends.js —— 好友关系相关接口
// 职责：查询好友列表、好友申请、好友关系状态，以及申请的发起/同意/拒绝/删除
// =====================================================

import client from './client'

// 获取当前用户的好友列表：GET /api/friends
export const getFriends = () =>
  client.get('/friends').then(r => r.data)

// 获取收到的待处理好友申请：GET /api/friends/requests
export const getFriendRequests = () =>
  client.get('/friends/requests').then(r => r.data)

// 查询与某用户的好友关系状态：GET /api/friends/status/:userId
// 返回 { status: 'none' | 'pending' | 'friends' }
export const getFriendStatus = (userId) =>
  client.get(`/friends/status/${userId}`).then(r => r.data)

// 向指定用户发送好友申请：POST /api/friends/request/:userId
export const sendFriendRequest = (userId) =>
  client.post(`/friends/request/${userId}`).then(r => r.data)

// 同意来自某用户的好友申请：POST /api/friends/accept/:userId
export const acceptFriendRequest = (userId) =>
  client.post(`/friends/accept/${userId}`).then(r => r.data)

// 拒绝来自某用户的好友申请：POST /api/friends/decline/:userId
export const declineFriendRequest = (userId) =>
  client.post(`/friends/decline/${userId}`).then(r => r.data)

// 删除好友关系：DELETE /api/friends/:userId（双向解除）
export const removeFriend = (userId) =>
  client.delete(`/friends/${userId}`).then(r => r.data)

// 设置对某好友的备注：PUT /api/friends/:userId/remark
export const setFriendRemark = (userId, remark) =>
  client.put(`/friends/${userId}/remark`, { remark })
