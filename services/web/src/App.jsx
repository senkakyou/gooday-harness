// =====================================================
// App.jsx —— 路由表 + 权限守卫
// 职责：定义"哪个 URL 显示哪个页面"，以及后台页面的登录保护
// =====================================================

import React, { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Toast from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'
import ChatBox from './components/ChatBox'
import BottomTabBar from './components/BottomTabBar'
import useAuthStore from './store/authStore'

const Home               = lazy(() => import('./pages/Home'))
const IframeTool         = lazy(() => import('./pages/IframeTool'))
const Account            = lazy(() => import('./pages/Account'))
const Messages           = lazy(() => import('./pages/Messages'))
const Notifications      = lazy(() => import('./pages/Notifications'))
const FavoritesPage      = lazy(() => import('./pages/FavoritesPage'))
const ForumHome          = lazy(() => import('./pages/forum/ForumHome'))
const CategoryPage       = lazy(() => import('./pages/forum/CategoryPage'))
const ThreadPage         = lazy(() => import('./pages/forum/ThreadPage'))
const SecondhandHome     = lazy(() => import('./pages/secondhand/SecondhandHome'))
const SecondhandDetail   = lazy(() => import('./pages/secondhand/SecondhandDetail'))
const GamesHome          = lazy(() => import('./pages/games/GamesHome'))
const GomokuRoom         = lazy(() => import('./pages/games/GomokuRoom'))
const ChessRoom          = lazy(() => import('./pages/games/ChessRoom'))
const RequestsHome       = lazy(() => import('./pages/requests/RequestsHome'))
const Invest             = lazy(() => import('./pages/Invest'))
const AudiobooksHome     = lazy(() => import('./pages/audiobooks/AudiobooksHome'))
const BookDetail         = lazy(() => import('./pages/audiobooks/BookDetail'))
const Reader             = lazy(() => import('./pages/audiobooks/Reader'))
const CoursesHome        = lazy(() => import('./pages/courses/CoursesHome'))
const SubjectPage        = lazy(() => import('./pages/courses/SubjectPage'))
const TeacherProfilePage = lazy(() => import('./pages/courses/TeacherProfilePage'))
const MyBookingsPage     = lazy(() => import('./pages/courses/MyBookingsPage'))
const Timetable          = lazy(() => import('./pages/courses/Timetable'))
const TeacherDashboard   = lazy(() => import('./pages/teacher/TeacherDashboard'))
const TeacherSchedule    = lazy(() => import('./pages/teacher/TeacherSchedule'))
const TeacherBookings    = lazy(() => import('./pages/teacher/TeacherBookings'))
const TeacherStudents    = lazy(() => import('./pages/teacher/TeacherStudents'))
const TeacherStudentDetail = lazy(() => import('./pages/teacher/TeacherStudentDetail'))
const AdminLayout        = lazy(() => import('./pages/admin/AdminLayout'))
const Stats              = lazy(() => import('./pages/admin/Stats'))
const Requests           = lazy(() => import('./pages/admin/Requests'))
const Tools              = lazy(() => import('./pages/admin/Tools'))
const Users              = lazy(() => import('./pages/admin/Users'))
const Purchases          = lazy(() => import('./pages/admin/Purchases'))
const Upload             = lazy(() => import('./pages/admin/Upload'))
const ChangePassword     = lazy(() => import('./pages/admin/ChangePassword'))
const ForumAdmin         = lazy(() => import('./pages/admin/ForumAdmin'))
const FileManager        = lazy(() => import('./pages/admin/FileManager'))
const Subjects           = lazy(() => import('./pages/admin/Subjects'))
const AdminAudiobooks    = lazy(() => import('./pages/admin/Audiobooks'))
const TeacherApprovals   = lazy(() => import('./pages/admin/TeacherApprovals'))
const TeacherHub         = lazy(() => import('./pages/admin/TeacherHub'))
const AdminTeacherDetail = lazy(() => import('./pages/admin/AdminTeacherDetail'))
const AdminTeacherStudentDetail = lazy(() => import('./pages/admin/AdminTeacherStudentDetail'))
const Announce           = lazy(() => import('./pages/admin/Announce'))
const AdminAccessLogs    = lazy(() => import('./pages/admin/AdminAccessLogs'))
const Tickets            = lazy(() => import('./pages/admin/Tickets'))
const Clients            = lazy(() => import('./pages/admin/Clients'))
const Projects           = lazy(() => import('./pages/admin/Projects'))
const Finance            = lazy(() => import('./pages/admin/Finance'))
const AdminSettings      = lazy(() => import('./pages/admin/Settings'))
const AdminApprove       = lazy(() => import('./pages/admin/Approve'))

// ---- 权限守卫组件 ----
// 包在需要 admin 权限的页面外层
// 如果当前用户不是 admin，直接跳回首页，页面内容不渲染
function AdminGuard({ children }) {
  const user = useAuthStore(s => s.user)  // 从全局状态读取当前登录用户
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
      {/* Navbar 和 Toast 全局显示，不随路由变化 */}
      <Navbar />
      <Toast />
      <ConfirmDialog />
      <ChatBox />
      <BottomTabBar />

      <Suspense fallback={null}>
      <Routes>
        {/* 首页：工具列表 + 需求表单 */}
        <Route path="/" element={<Home />} />

        {/* 工具在线运行页：URL 里的 :slug 是工具唯一标识，如 /tool/pdf-merge */}
        <Route path="/tool/:slug" element={<IframeTool />} />

        {/* 投资：收息者买点评分卡 */}
        <Route path="/invest" element={<Invest />} />

        {/* 账户（登录用户） */}
        <Route path="/account" element={<Account />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* 需求模块 */}
        <Route path="/requests" element={<RequestsHome />} />

        {/* 论坛 */}
        <Route path="/forum" element={<ForumHome />} />
        <Route path="/forum/c/:slug" element={<CategoryPage />} />
        <Route path="/forum/t/:id" element={<ThreadPage />} />

        {/* 游戏中心 */}
        <Route path="/games" element={<GamesHome />} />
        <Route path="/games/gomoku" element={<GomokuRoom />} />
        <Route path="/games/chess" element={<ChessRoom />} />

        {/* 听书 */}
        <Route path="/audiobooks" element={<AudiobooksHome />} />
        <Route path="/audiobooks/:id" element={<BookDetail />} />
        <Route path="/audiobooks/:id/read" element={<Reader />} />

        {/* 二手交易 */}
        <Route path="/secondhand" element={<SecondhandHome />} />
        <Route path="/secondhand/:id" element={<SecondhandDetail />} />

        {/* 课程预约 */}
        <Route path="/courses" element={<CoursesHome />} />
        <Route path="/courses/subject/:subjectId" element={<SubjectPage />} />
        <Route path="/courses/teacher/:id" element={<TeacherProfilePage />} />
        <Route path="/courses/my-bookings" element={<MyBookingsPage />} />
        <Route path="/courses/timetable" element={<Timetable mode="student" />} />

        {/* 教师端 */}
        <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
        <Route path="/teacher/schedule" element={<TeacherSchedule />} />
        <Route path="/teacher/timetable" element={<Timetable mode="teacher" />} />
        <Route path="/teacher/bookings" element={<TeacherBookings />} />
        <Route path="/teacher/students" element={<TeacherStudents />} />
        <Route path="/teacher/students/:id" element={<TeacherStudentDetail />} />

        {/* 后台页面组：AdminGuard 检查权限，AdminLayout 提供左侧菜单框架 */}
        {/* 子路由的内容渲染在 AdminLayout 的 <Outlet /> 位置 */}
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <AdminLayout />
            </AdminGuard>
          }
        >
          <Route index element={<Stats />} />              {/* /admin → 数据概览 */}
          <Route path="requests" element={<Requests />} /> {/* /admin/requests → 需求管理 */}
          <Route path="tools" element={<Tools />} />       {/* /admin/tools → 工具管理 */}
          <Route path="users" element={<Users />} />       {/* /admin/users → 用户管理 */}
          <Route path="purchases" element={<Purchases />} />{/* /admin/purchases → 购买记录 */}
          <Route path="upload" element={<Upload />} />     {/* /admin/upload → 文件上传 */}
          <Route path="password" element={<ChangePassword />} />{/* /admin/password → 改密码 */}
          <Route path="forum" element={<ForumAdmin />} />
          <Route path="files" element={<FileManager />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="audiobooks" element={<AdminAudiobooks />} />{/* /admin/audiobooks → 听书管理 */}
          <Route path="teachers" element={<TeacherHub />} />
          <Route path="teachers/:id" element={<AdminTeacherDetail />} />
          <Route path="teachers/:id/students/:sid" element={<AdminTeacherStudentDetail />} />
          <Route path="announce" element={<Announce />} />
          <Route path="access-logs" element={<AdminAccessLogs />} />
          <Route path="tickets" element={<Tickets />} />      {/* /admin/tickets → 工单管理 */}
          <Route path="clients" element={<Clients />} />      {/* /admin/clients → 客户档案 */}
          <Route path="projects" element={<Projects />} />    {/* /admin/projects → 项目管理 */}
          <Route path="finance" element={<Finance />} />      {/* /admin/finance → 财务管理 */}
          <Route path="settings" element={<AdminSettings />} />{/* /admin/settings → 系统设置（智能体+模型） */}
          <Route path="approve" element={<AdminApprove />} />{/* /admin/approve → 小额自动放行审批 */}
        </Route>
      </Routes>
      </Suspense>
    </>
  )
}
