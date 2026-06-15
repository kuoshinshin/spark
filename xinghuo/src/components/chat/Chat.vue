<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { chatApi, userApi, notificationApi } from '../../services/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DEFAULT_AVATAR, normalizeAvatar, avatarDisplayUrl } from '../../utils/avatar'

const route = useRoute()
const router = useRouter()
const POLL_INTERVAL_MS = 20000

// 日期格式化函数
const formatDate = (dateString) => {
  if (!dateString) return ''
  
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return dateString
  
  const now = new Date()
  const diffTime = now - date
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  
  // 格式化时间，使用12小时制，上午/下午
  const timeStr = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })
  
  if (diffDays === 0) {
    // 今天，显示时间
    return timeStr
  } else if (diffDays === 1) {
    // 昨天，显示 "昨天 时间"
    return `昨天 ${timeStr}`
  } else {
    // 比昨天更早，显示完整日期和时间
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }
}

// 判断是否应该显示评论时间
const shouldShowCommentTime = (comments, index) => {
  // 第一条评论总是显示时间
  if (index === 0) {
    return true
  }
  
  // 如果没有评论或评论数量不足，显示时间
  if (!comments || comments.length < 2) {
    return true
  }
  
  // 获取当前评论和上一条评论的时间
  const currentComment = comments[index]
  const prevComment = comments[index - 1]
  
  if (!currentComment || !prevComment || !currentComment.timestamp || !prevComment.timestamp) {
    return true
  }
  
  // 计算时间差（毫秒）
  const currentTime = new Date(currentComment.timestamp).getTime()
  const prevTime = new Date(prevComment.timestamp).getTime()
  
  // 如果时间差超过1小时（3600000毫秒），显示时间
  return (currentTime - prevTime) > 3600000
}

// 用户数据
const currentUser = ref({
  id: 1,
  name: '我',
  avatar: DEFAULT_AVATAR
})

/** 与 auth 登录结构对齐：合并写入，避免覆盖掉 role 导致导航「后台」消失 */
function mergeUserDataToStorage(partial) {
  try {
    const raw = localStorage.getItem('userData')
    let prev = {}
    if (raw) {
      try {
        prev = JSON.parse(raw)
        if (typeof prev !== 'object' || prev === null) prev = {}
      } catch {
        prev = {}
      }
    }
    localStorage.setItem('userData', JSON.stringify({ ...prev, ...partial }))
  } catch (error) {
    console.error('保存用户数据失败:', error)
  }
}

// 帖子数据
const posts = ref([])
const isLoading = ref(false)
const errorMessage = ref('')

// 搜索和排序
const searchKeyword = ref('')
const sortType = ref('latest') // latest 最新, hottest 最热

// 发布帖子相关
const showPostModal = ref(false)
const postContent = ref('')
const postMedia = ref('')
const mediaType = ref('image') // image 图片, video 视频
const isPosting = ref(false)

// 评论相关
const commentInputs = ref({})

// 编辑相关
const showEditModal = ref(false)
const editingPost = ref(null)
const editContent = ref('')
const editMedia = ref('')
const editMediaType = ref('image')
const isEditing = ref(false)

// 评论点赞相关
const commentLikes = ref({})



// 评论展开状态
const showAllComments = ref({})

// 过滤后的帖子
const filteredPosts = ref([])
const notifications = ref([])
const unreadCount = ref(0)
const showNotificationPanel = ref(false)
let pollTimer = null

const unreadNotificationCount = computed(() => Number(unreadCount.value || notifications.value.filter(item => !item.read).length))
const groupedNotifications = computed(() => {
  const groups = {}
  notifications.value.forEach((item) => {
    const date = new Date(item.createdAt || Date.now())
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const startOfItemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const diffDays = Math.round((startOfToday - startOfItemDay) / 86400000)
    let label = '更早'
    if (diffDays === 0) label = '今天'
    else if (diffDays === 1) label = '昨天'
    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  })
  const order = ['今天', '昨天', '更早']
  return order.filter(label => groups[label]?.length).map(label => ({ label, items: groups[label] }))
})

const mapNotificationContent = (item) => {
  const actorName = item.actorName || '有人'
  if (item.type === 'post_like') return `${actorName} 点赞了你的动态`
  if (item.type === 'post_comment') return `${actorName} 评论了你的动态`
  return '你有一条新通知'
}

const normalizeNotifications = (list) => {
  if (!Array.isArray(list)) return []
  const mapped = list.map(item => ({
    ...item,
    read: Boolean(item.isRead),
    content: mapNotificationContent(item),
    postPreview: String(item.postContent || '').slice(0, 40),
    createdAt: item.createdAt || new Date().toISOString(),
    aggregateCount: 1,
    notificationIds: [item.id],
  }))

  // 同类通知聚合：同一帖子 + 同一类型 + 同一已读状态
  const merged = []
  mapped.forEach((item) => {
    const hit = merged.find(existing =>
      existing.type === item.type &&
      existing.postId === item.postId &&
      existing.read === item.read
    )
    if (hit) {
      hit.aggregateCount += 1
      hit.notificationIds.push(item.id)
      if (new Date(item.createdAt).getTime() > new Date(hit.createdAt).getTime()) {
        hit.createdAt = item.createdAt
      }
      return
    }
    merged.push({ ...item })
  })

  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return merged
}

const fetchNotifications = async () => {
  try {
    const [list, countResp] = await Promise.all([
      notificationApi.listMyNotifications(50),
      notificationApi.getUnreadCount()
    ])
    notifications.value = normalizeNotifications(list)
    unreadCount.value = Number(countResp?.unreadCount || 0)
  } catch (error) {
    console.error('获取通知失败:', error)
  }
}

const markAllNotificationsRead = () => {
  notificationApi.markAllRead()
    .then(() => {
      notifications.value = notifications.value.map(item => ({ ...item, read: true }))
      unreadCount.value = 0
    })
    .catch((error) => {
      console.error('标记通知已读失败:', error)
      ElMessage.error('标记通知已读失败，请稍后重试')
    })
}

const openNotification = (item) => {
  const ids = Array.isArray(item.notificationIds) && item.notificationIds.length ? item.notificationIds : [item.id]
  Promise.all(ids.map(id => notificationApi.markNotificationRead(id))).catch((error) => {
    console.error('标记通知已读失败:', error)
  })
  notifications.value = notifications.value.map(n => n.id === item.id ? { ...n, read: true } : n)
  unreadCount.value = Math.max(0, unreadCount.value - ids.length)
  showNotificationPanel.value = false
  if (item.postId) {
    scrollToPost(String(item.postId))
  }
}

// 打开发布帖子模态框
const openPostModal = () => {
  showPostModal.value = true
}

const resetPostModalForm = () => {
  postContent.value = ''
  postMedia.value = ''
  mediaType.value = 'image'
}

const closePostModal = () => {
  showPostModal.value = false
}

// 打开编辑帖子模态框
const openEditModal = (post) => {
  editingPost.value = post
  editContent.value = post.content
  editMedia.value = post.media || ''
  editMediaType.value = post.mediaType || 'image'
  showEditModal.value = true
}

const resetEditModalForm = () => {
  editingPost.value = null
  editContent.value = ''
  editMedia.value = ''
  editMediaType.value = 'image'
  isEditing.value = false
}

const closeEditModal = () => {
  showEditModal.value = false
}

// 保存编辑
const saveEdit = async () => {
  if (!editContent.value.trim() || !editingPost.value) return
  
  isEditing.value = true
  
  try {
    const post = posts.value.find(p => p.id === editingPost.value.id)
    if (post) {
      post.content = editContent.value.trim()
      post.media = editMedia.value
      post.mediaType = editMediaType.value
      post.timestamp = '刚刚'
    }
    
    // 更新过滤后的帖子
    applySearchAndSort()
    closeEditModal()
    ElMessage.success('编辑成功')
  } catch (error) {
    console.error('编辑失败:', error)
    ElMessage.error('编辑失败，请联系管理员')
  } finally {
    isEditing.value = false
  }
}

// 删除帖子
const deletePost = async (postId) => {
  try {
    await ElMessageBox.confirm('确定要删除这条动态吗？', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  try {
    // 调用后端API删除帖子
    await chatApi.deletePost(postId)
    
    // 从前端列表中移除
    const postIndex = posts.value.findIndex(p => p.id === postId)
    if (postIndex !== -1) {
      posts.value.splice(postIndex, 1)
      // 更新过滤后的帖子
      applySearchAndSort()
    }
    
    ElMessage.success('删除成功')
  } catch (error) {
    console.error('删除失败:', error)
    ElMessage.error('删除失败，请联系管理员')
  }
}

// 评论点赞
const likeComment = async (postId, commentId) => {
  // 检查用户是否登录
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
  if (!isLoggedIn) {
    ElMessage.warning('请先登录后再点赞')
    return
  }
  
  // 初始化评论点赞状态
  if (!commentLikes.value[commentId]) {
    commentLikes.value[commentId] = 0
  }
  
  // 切换点赞状态
  const isLiked = commentLikes.value[commentId] > 0
  const newLikeState = isLiked ? 0 : 1
  
  // 先更新前端状态，提供即时反馈
  commentLikes.value[commentId] = newLikeState
  applySearchAndSort()
  
  try {
    // 调用后端API点赞或取消点赞评论
    if (newLikeState === 1) {
      try {
        await chatApi.likeComment(commentId)
      } catch (error) {
        // 如果已经点赞过了，尝试取消点赞
        if (error.message === '已经点赞过了') {
          await chatApi.unlikeComment(commentId)
        } else {
          throw error
        }
      }
    } else {
      await chatApi.unlikeComment(commentId)
    }
  } catch (error) {
    // 如果API调用失败，恢复前端状态
    console.error('评论点赞失败:', error)
    commentLikes.value[commentId] = isLiked ? 1 : 0
    applySearchAndSort()
    // 不要显示错误提示，因为取消点赞时可能会失败
  }
}







// 切换评论展开状态
const toggleComments = (postId) => {
  // 初始化展开状态
  if (!showAllComments.value[postId]) {
    showAllComments.value[postId] = false
  }
  
  // 切换状态
  showAllComments.value[postId] = !showAllComments.value[postId]
  
  // 如果是收起评论，滑动到帖子头部
  if (!showAllComments.value[postId]) {
    scrollToPost(postId)
  }
}

// 获取显示的评论
const getDisplayComments = (post) => {
  if (!post.comments || post.comments.length === 0) {
    return []
  }
  
  // 如果已展开，显示所有评论
  if (showAllComments.value[post.id]) {
    return post.comments
  }
  
  // 否则，显示点赞数最多的一条评论
  const sortedComments = [...post.comments].sort((a, b) => {
    const likesA = commentLikes.value[a.id] || 0
    const likesB = commentLikes.value[b.id] || 0
    return likesB - likesA
  })
  
  return sortedComments.slice(0, 1)
}

// 转发帖子（调用后端API）
const sharePost = async (postId) => {
  try {
    // 检查用户是否登录
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
    if (!isLoggedIn) {
      ElMessage.warning('请先登录后再分享')
      return
    }
    
    // 调用后端API进行分享
    const response = await chatApi.sharePost(postId)
    
    // 复制分享链接到剪贴板
    const url = `${window.location.origin}${window.location.pathname}#/chat?postId=${encodeURIComponent(postId)}`
    await navigator.clipboard.writeText(url)
    
    ElMessage.success('分享成功！链接已复制到剪贴板')
  } catch (error) {
    console.error('分享失败:', error)
    ElMessage.error('分享失败，请联系管理员')
  }
}

// 检查帖子点赞状态
const checkPostLikeStatus = async () => {
  try {
    // 检查用户是否登录
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
    if (!isLoggedIn) return
    
    // 检查每个帖子的点赞状态
    for (const post of posts.value) {
      try {
        const response = await chatApi.checkLike(post.id)
        post.isLiked = response.isLiked
      } catch (error) {
        console.error('检查帖子点赞状态失败:', error)
        post.isLiked = false
      }
    }
    // 应用搜索和排序
    applySearchAndSort()
  } catch (error) {
    console.error('检查点赞状态失败:', error)
  }
}

// 获取帖子数据
const fetchPosts = async ({ silent = false } = {}) => {
  if (!silent) {
    isLoading.value = true
    errorMessage.value = ''
  }
  try {
    const response = await chatApi.getMessages()
    posts.value = response
    // 初始化评论输入框和评论相关状态
    posts.value.forEach(post => {
      commentInputs.value[post.id] = ''
      // 初始化isLiked状态
      post.isLiked = false
      // 确保comments数组存在
      if (!post.comments) {
        post.comments = []
      }
      // 处理评论数据，确保用户信息和时间正确
      post.comments.forEach(comment => {
        // 确保评论有user字段
        if (!comment.user) {
          // 尝试从其他字段获取用户信息
          if (comment.username || comment.user_id) {
            comment.user = {
              id: comment.user_id || comment.id,
              name: comment.username || '用户',
              avatar: normalizeAvatar(comment.avatar)
            }
          } else {
            // 如果没有用户信息，使用默认值
            comment.user = {
              id: comment.id,
              name: '用户',
              avatar: DEFAULT_AVATAR
            }
          }
        }
        // 确保评论有timestamp字段
        if (!comment.timestamp) {
          // 尝试从其他字段获取时间信息
          if (comment.created_at) {
            comment.timestamp = comment.created_at
          } else {
            // 如果没有时间信息，使用当前时间
            comment.timestamp = new Date().toISOString()
          }
        }
        // 初始化评论点赞状态
        if (!commentLikes.value[comment.id]) {
          commentLikes.value[comment.id] = comment.likes || 0
        }
      })
    })
    // 检查帖子点赞状态
    await checkPostLikeStatus()
    // 应用搜索和排序
    applySearchAndSort()
  } catch (error) {
    if (!silent) {
      errorMessage.value = error.message || '获取帖子失败，请联系管理员'
    }
    console.error('获取帖子失败:', error)
  } finally {
    if (!silent) {
      isLoading.value = false
    }
  }
}

// 应用搜索和排序
const applySearchAndSort = () => {
  let result = [...posts.value]
  
  // 应用搜索
  if (searchKeyword.value.trim()) {
    const keyword = searchKeyword.value.trim().toLowerCase()
    result = result.filter(post => 
      post.content.toLowerCase().includes(keyword) ||
      (post.user?.name && post.user.name.toLowerCase().includes(keyword))
    )
  }
  
  // 应用排序
  if (sortType.value === 'hottest') {
    // 按点赞数排序
    result.sort((a, b) => {
      const likesA = typeof a.likes === 'number' && !isNaN(a.likes) ? a.likes : 0
      const likesB = typeof b.likes === 'number' && !isNaN(b.likes) ? b.likes : 0
      return likesB - likesA
    })
  } else {
    // 按时间排序（最新在前）
    result.sort((a, b) => {
      if (a.timestamp === '刚刚') return -1
      if (b.timestamp === '刚刚') return 1
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      // 简单的时间排序逻辑，实际项目中可能需要更复杂的时间处理
      return b.timestamp.localeCompare(a.timestamp)
    })
  }
  
  filteredPosts.value = result
}

// 发布帖子
const publishPost = async () => {
  if (!postContent.value.trim()) return
  
  isPosting.value = true
  
  try {
    const response = await chatApi.sendMessage({
      content: postContent.value.trim(),
      media: postMedia.value,
      mediaType: mediaType.value
    })
    
    // 添加新帖子到列表
    const newPost = {
      id: response.id,
      user: currentUser.value,
      content: postContent.value.trim(),
      media: postMedia.value,
      mediaType: mediaType.value,
      timestamp: '刚刚',
      likes: 0,
      comments: [],
      isLiked: false,
      isMine: true
    }
    
    posts.value.unshift(newPost)
    commentInputs.value[newPost.id] = ''
    applySearchAndSort()
    closePostModal()
  } catch (error) {
    console.error('发布帖子失败:', error)
    ElMessage.error('发布帖子失败，请联系管理员')
  } finally {
    isPosting.value = false
  }
}

// 切换点赞状态
const toggleLike = async (postId) => {
  try {
    // 检查用户是否登录
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
    if (!isLoggedIn) {
      ElMessage.warning('请先登录后再点赞')
      return
    }
    
    const post = posts.value.find(p => p.id === postId)
    if (post) {
      // 确保likes是一个有效的数字
      if (typeof post.likes !== 'number' || isNaN(post.likes)) {
        post.likes = 0
      }
      // 确保isLiked是一个布尔值
      if (post.isLiked === undefined) {
        post.isLiked = false
      }
      
      // 先更新前端状态，提供即时反馈
      const newLikedState = !post.isLiked
      const likeChange = newLikedState ? 1 : -1
      post.isLiked = newLikedState
      post.likes += likeChange
      // 更新过滤后的帖子
      applySearchAndSort()
      
      // 调用后端API，持久化点赞状态
      try {
        if (newLikedState) {
          await chatApi.likePost(postId)
        } else {
          await chatApi.unlikePost(postId)
        }
      } catch (apiError) {
        // 如果API调用失败，恢复前端状态
        console.error('点赞API调用失败:', apiError)
        post.isLiked = !newLikedState
        post.likes -= likeChange
        applySearchAndSort()
      }
    }
  } catch (error) {
    console.error('点赞失败:', error)
  }
}

// 发表评论
const addComment = async (postId) => {
  const post = posts.value.find(p => p.id === postId)
  const commentContent = commentInputs.value[postId]
  
  if (post && commentContent && commentContent.trim()) {
    try {
      // 检查用户是否登录
      const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
      if (!isLoggedIn) {
        ElMessage.warning('请先登录后再评论')
        return
      }
      
      // 调用后端API添加评论
      const response = await chatApi.addComment(postId, commentContent.trim())
      
      // 添加新评论到列表
      const newComment = {
        id: response.id,
        user: currentUser.value,
        content: commentContent.trim(),
        timestamp: '刚刚'
      }
      
      if (!post.comments) {
        post.comments = []
      }
      post.comments.push(newComment)
      commentInputs.value[postId] = ''
      
      mergeUserDataToStorage({
        username: currentUser.value.name,
        avatar: currentUser.value.avatar,
        id: currentUser.value.id
      })
      
      // 更新过滤后的帖子
      applySearchAndSort()
    } catch (error) {
      console.error('发表评论失败:', error)
      ElMessage.error('发表评论失败，请联系管理员')
    }
  }
}

// 处理搜索
const handleSearch = () => {
  applySearchAndSort()
}

// 处理排序变化
const handleSortChange = () => {
  applySearchAndSort()
}

// 查看用户个人信息
const viewUserProfile = (userId) => {
  if (userId == null || userId === '') return
  router.push({ name: 'profile', query: { userId: String(userId) } })
}

// 滚动到指定帖子
const scrollToPost = (postId) => {
  setTimeout(() => {
    const postElement = document.querySelector(`.post-card[data-post-id="${postId}"]`)
    if (postElement) {
      postElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 添加高亮效果
      postElement.style.boxShadow = '0 0 0 2px #0071e3'
      setTimeout(() => {
        postElement.style.boxShadow = ''
      }, 2000)
    }
  }, 100)
}

const startNotificationPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    fetchPosts({ silent: true })
    fetchNotifications()
  }, POLL_INTERVAL_MS)
}

const stopNotificationPolling = () => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

// 组件挂载
onMounted(async () => {
  // 检查是否已登录
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
  const token = localStorage.getItem('token')
  
  if (isLoggedIn && token) {
    try {
      // 从后端 API 获取用户信息
      const userInfo = await userApi.getUserInfo()
      if (userInfo) {
        currentUser.value.id = userInfo.id || currentUser.value.id
        currentUser.value.name = userInfo.username || userInfo.name || currentUser.value.name
        currentUser.value.avatar = normalizeAvatar(userInfo.avatar)
        
        mergeUserDataToStorage({
          username: currentUser.value.name,
          avatar: currentUser.value.avatar,
          id: currentUser.value.id,
          ...(userInfo.role != null && userInfo.role !== '' ? { role: userInfo.role } : {}),
          ...(userInfo.account != null && userInfo.account !== '' ? { account: userInfo.account } : {})
        })
      }
    } catch (error) {
      console.error('获取用户信息失败:', error)
      // 如果获取失败，从本地存储加载
      const savedUserData = localStorage.getItem('userData')
      if (savedUserData) {
        try {
          const userData = JSON.parse(savedUserData)
          currentUser.value.name = userData.username || currentUser.value.name
          currentUser.value.avatar = normalizeAvatar(userData.avatar)
          currentUser.value.id = userData.id || currentUser.value.id
        } catch (error) {
          console.error('加载用户数据失败:', error)
        }
      }
    }
  } else {
    // 从本地存储加载用户数据
    const savedUserData = localStorage.getItem('userData')
    if (savedUserData) {
      try {
        const userData = JSON.parse(savedUserData)
        currentUser.value.name = userData.username || currentUser.value.name
        currentUser.value.avatar = normalizeAvatar(userData.avatar)
        currentUser.value.id = userData.id || currentUser.value.id
      } catch (error) {
        console.error('加载用户数据失败:', error)
      }
    }
  }
  
  await fetchPosts()
  await fetchNotifications()

  const postId = route.query.postId
  if (postId) scrollToPost(String(postId))
  startNotificationPolling()
})

onUnmounted(() => {
  stopNotificationPolling()
})

watch(
  () => route.query.postId,
  (postId) => {
    if (postId) scrollToPost(String(postId))
  }
)
</script>

<template>
  <div class="circle-container">
    <!-- 页面头部 -->
    <div class="circle-header">
      <div class="container">
        <h1>圈子</h1>
        <p>分享你的游戏精彩瞬间，与其他玩家交流互动</p>
      </div>
    </div>
    
    <!-- 搜索和排序栏 -->
    <div class="search-sort-bar">
      <div class="container">
        <div class="sort-toggle" role="tablist" aria-label="排序方式">
            <button
              type="button"
              class="sort-button"
              :class="{ active: sortType === 'latest' }"
              role="tab"
              :aria-selected="sortType === 'latest'"
              @click="sortType = 'latest'; handleSortChange()"
            >
              最新
            </button>
            <button
              type="button"
              class="sort-button"
              :class="{ active: sortType === 'hottest' }"
              role="tab"
              :aria-selected="sortType === 'hottest'"
              @click="sortType = 'hottest'; handleSortChange()"
            >
              最热
            </button>
            <div
              class="toggle-slider"
              :class="{ hottest: sortType === 'hottest' }"
              aria-hidden="true"
            />
          </div>
        <div class="search-box">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索动态或用户..."
            clearable
            class="search-bar-input"
            @input="handleSearch"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="search-prefix-icon">
                <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </template>
          </el-input>
        </div>
        <div class="notification-wrapper">
          <el-button class="notification-button" @click="showNotificationPanel = !showNotificationPanel">
            通知
            <span v-if="unreadNotificationCount > 0" class="notification-badge">{{ unreadNotificationCount }}</span>
          </el-button>
          <div v-if="showNotificationPanel" class="notification-panel">
            <div class="notification-header">
              <span>互动通知</span>
              <el-button text @click="markAllNotificationsRead">全部已读</el-button>
            </div>
            <div v-if="notifications.length === 0" class="notification-empty">暂无通知</div>
            <div v-else class="notification-list">
              <div v-for="group in groupedNotifications" :key="group.label" class="notification-group">
                <p class="notification-group-title">{{ group.label }}</p>
                <div
                  v-for="item in group.items"
                  :key="item.id"
                  class="notification-item"
                  :class="{ unread: !item.read }"
                  @click="openNotification(item)"
                >
                  <p class="notification-content">
                    {{ item.content }}
                    <span v-if="item.aggregateCount > 1" class="notification-count">x{{ item.aggregateCount }}</span>
                  </p>
                  <p v-if="item.postPreview" class="notification-preview">「{{ item.postPreview }}」</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 主内容区 -->
    <div class="main-content">
      <div class="container">
        <!-- 左侧边栏 -->
        <div class="sidebar">
          <div class="user-card">
            <el-avatar :src="avatarDisplayUrl(currentUser.avatar)" :size="80" class="user-avatar" />
            <h3>{{ currentUser.name }}</h3>
            <el-button type="primary" class="post-button" @click="openPostModal">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              发布动态
            </el-button>
          </div>
          <div class="sidebar-info">
            <h4>关于圈子</h4>
            <p>这里是游戏玩家的聚集地，分享游戏心得、精彩瞬间和攻略技巧，与其他玩家一起交流互动。</p>
          </div>
        </div>
        
        <!-- 中间内容区 -->
        <div class="content-area">
          <!-- 帖子列表 -->
          <div class="posts-list">
            <!-- 加载状态 -->
            <div v-if="isLoading" class="loading-state loading-skeleton-state">
              <div v-for="item in 3" :key="`post-skeleton-${item}`" class="post-card post-skeleton-card">
                <el-skeleton animated>
                  <template #template>
                    <div class="post-skeleton-header">
                      <el-skeleton-item variant="circle" class="post-skeleton-avatar" />
                      <div class="post-skeleton-user">
                        <el-skeleton-item variant="text" class="post-skeleton-name" />
                        <el-skeleton-item variant="text" class="post-skeleton-time" />
                      </div>
                    </div>
                    <div class="post-skeleton-content">
                      <el-skeleton-item variant="p" class="post-skeleton-line" />
                      <el-skeleton-item variant="p" class="post-skeleton-line" />
                      <el-skeleton-item variant="rect" class="post-skeleton-media" />
                    </div>
                    <div class="post-skeleton-actions">
                      <el-skeleton-item variant="button" class="post-skeleton-action-btn" />
                    </div>
                    <div class="post-skeleton-comment">
                      <el-skeleton-item variant="circle" class="post-skeleton-comment-avatar" />
                      <el-skeleton-item variant="text" class="post-skeleton-comment-input" />
                    </div>
                  </template>
                </el-skeleton>
              </div>
            </div>
            
            <!-- 错误信息 -->
            <div v-else-if="errorMessage" class="error-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V12M12 16H12.01M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <p>{{ errorMessage }}</p>
              <el-button type="primary" class="retry-button" @click="fetchPosts">重试</el-button>
            </div>
            
            <!-- 帖子列表 -->
            <div v-else-if="filteredPosts.length > 0">
              <div 
                v-for="post in filteredPosts" 
                :key="post.id" 
                class="post-card"
                :data-post-id="post.id"
              >
                <!-- 帖子头部 -->
                <div class="post-header">
                  <div class="post-user">
                    <el-avatar
                      :src="avatarDisplayUrl(post.avatar || post.user?.avatar)"
                      :size="48"
                      class="user-avatar post-user-avatar-click"
                      @click="viewUserProfile(post.userId || post.user?.id)"
                    />
                    <div class="user-info">
                      <h3 
                        @click="viewUserProfile(post.userId || post.user?.id)"
                        style="cursor: pointer;"
                      >
                        {{ post.username || post.user?.name || '未知用户' }}
                      </h3>
                      <span class="post-time">{{ post.timestamp === '刚刚' ? '刚刚' : formatDate(post.timestamp || post.created_at) }}</span>
                    </div>
                  </div>
                  <div class="post-actions-dropdown">
                    <!-- 编辑和删除按钮 -->
                    <el-dropdown v-if="currentUser.name === (post.username || post.user?.name)" trigger="click" placement="bottom-end">
                      <el-button text class="dropdown-button" aria-label="帖子操作">
                        <svg width="20" height="20" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M746.662019 512c0 51.835575 42.044582 93.865831 93.865831 93.865831 51.851948 0 93.865831-42.029232 93.865831-93.865831 0-51.836599-42.013883-93.865831-93.865831-93.865831C788.706601 418.135192 746.662019 460.163401 746.662019 512z" fill="currentColor"></path><path d="M89.604272 512c0 51.835575 42.043558 93.865831 93.864808 93.865831 51.822272 0 93.865831-42.029232 93.865831-93.865831 0-51.836599-42.043558-93.865831-93.865831-93.865831C131.648854 418.135192 89.604272 460.163401 89.604272 512z" fill="currentColor"></path><path d="M418.132634 512c0 51.835575 42.013883 93.865831 93.866854 93.865831 51.821249 0 93.864808-42.029232 93.864808-93.865831 0-51.836599-42.043558-93.865831-93.864808-93.865831C460.146517 418.135192 418.132634 460.163401 418.132634 512z" fill="currentColor"></path></svg>
                      </el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item @click="openEditModal(post)">
                            编辑
                          </el-dropdown-item>
                          <el-dropdown-item @click="deletePost(post.id)" class="delete-button">
                            删除
                          </el-dropdown-item>
                          <el-dropdown-item @click="sharePost(post.id)" class="custom-dropdown-item">
                            分享
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                    <!-- 普通下拉按钮 -->
                    <el-dropdown v-else trigger="click" placement="bottom-end">
                      <el-button text class="dropdown-button" aria-label="帖子操作">
                        <svg width="20" height="20" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M746.662019 512c0 51.835575 42.044582 93.865831 93.865831 93.865831 51.851948 0 93.865831-42.029232 93.865831-93.865831 0-51.836599-42.013883-93.865831-93.865831-93.865831C788.706601 418.135192 746.662019 460.163401 746.662019 512z" fill="currentColor"></path><path d="M89.604272 512c0 51.835575 42.043558 93.865831 93.864808 93.865831 51.822272 0 93.865831-42.029232 93.865831-93.865831 0-51.836599-42.043558-93.865831-93.865831-93.865831C131.648854 418.135192 89.604272 460.163401 89.604272 512z" fill="currentColor"></path><path d="M418.132634 512c0 51.835575 42.013883 93.865831 93.866854 93.865831 51.821249 0 93.864808-42.029232 93.864808-93.865831 0-51.836599-42.043558-93.865831-93.864808-93.865831C460.146517 418.135192 418.132634 460.163401 418.132634 512z" fill="currentColor"></path></svg>
                      </el-button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item @click="sharePost(post.id)" class="custom-dropdown-item">
                            分享
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                
                <!-- 帖子内容 -->
                <div class="post-content">
                  <p>{{ post.content }}</p>
                  <div v-if="post.media" class="post-media-container">
                    <el-image
                      v-if="post.mediaType === 'image'"
                      :src="post.media"
                      :alt="post.content"
                      fit="cover"
                      class="post-media image"
                    />
                    <video v-else-if="post.mediaType === 'video'" :src="post.media" class="post-media video" controls></video>
                  </div>
                </div>
                
                <!-- 帖子操作 -->
                <div class="post-actions">
                  <el-button
                    text
                    class="action-button"
                    :class="{ active: post.isLiked }"
                    @click="toggleLike(post.id)"
                  >
                    <svg v-if="!post.isLiked" width="20" height="20" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512.042667 193.237333a255.914667 255.914667 0 0 1 351.658666 9.728 256 256 0 0 1 10.069334 351.402667l-361.813334 362.325333-361.728-362.325333a256 256 0 0 1 361.813334-361.130667z m291.242666 70.016a170.581333 170.581333 0 0 0-234.24-6.528l-56.96 51.114667-57.002666-51.072a170.666667 170.666667 0 0 0-242.602667 239.146667L512 795.904l299.52-299.946667a170.666667 170.666667 0 0 0-8.234667-232.704z" fill="#86868b"></path></svg>
                    <svg v-else width="20" height="20" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512 901.746939c-13.583673 0-26.122449-4.179592-37.093878-13.061225-8.881633-7.314286-225.697959-175.020408-312.424489-311.379592C133.746939 532.37551 94.040816 471.24898 94.040816 384.522449c0-144.718367 108.146939-262.269388 240.326531-262.269388 67.395918 0 131.657143 30.82449 177.632653 84.636735 45.453061-54.334694 109.191837-84.636735 177.110204-84.636735 132.702041 0 240.326531 117.55102 240.326531 262.269388 0 85.159184-37.093878 143.673469-67.395919 191.216327l-1.044898 1.567346c-86.726531 136.359184-303.542857 304.587755-312.424489 311.379592-10.44898 8.359184-22.987755 13.061224-36.571429 13.061225z" fill="#E5404F"></path></svg>
                    <span>{{ post.likes }}</span>
                  </el-button>
                </div>
                
                <!-- 评论区 -->
                <div class="comments-section">
                  <!-- 评论列表 -->
                  <div class="comments-list">
                    <div 
                      v-for="(comment, index) in getDisplayComments(post)" 
                      :key="comment.id" 
                      class="comment-item"
                      :class="{ 'own-comment': comment.user?.id == currentUser.id || comment.user?.name === currentUser.name }"
                    >
                      <!-- 计算与上一条评论的时间差，超过1小时显示时间 -->
                      <div v-if="shouldShowCommentTime(post.comments, index)" class="comment-time-container">
                        <span class="comment-time">{{ comment.timestamp === '刚刚' ? '刚刚' : formatDate(comment.timestamp) }}</span>
                      </div>
                      <div class="comment-content-wrapper">
                        <!-- 如果是当前用户，点赞按钮在左侧外面 -->
                        <template v-if="comment.user?.id == currentUser.id || comment.user?.name === currentUser.name">
                          <div class="comment-avatar-container">
                            <el-avatar
                              :src="avatarDisplayUrl(comment.user?.avatar)"
                              :size="32"
                              class="comment-avatar"
                            />
                            <span class="comment-user">{{ comment.user?.name || '未知用户' }}</span>
                          </div>
                          <div class="comment-body-wrapper">
                            <el-button
                              text
                              class="comment-action-button like-button-left"
                              :class="{ active: commentLikes[comment.id] > 0 }"
                              @click="likeComment(post.id, comment.id)"
                            >
                              <svg v-if="!(commentLikes[comment.id] > 0)" width="14" height="14" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512.042667 193.237333a255.914667 255.914667 0 0 1 351.658666 9.728 256 256 0 0 1 10.069334 351.402667l-361.813334 362.325333-361.728-362.325333a256 256 0 0 1 361.813334-361.130667z m291.242666 70.016a170.581333 170.581333 0 0 0-234.24-6.528l-56.96 51.114667-57.002666-51.072a170.666667 170.666667 0 0 0-242.602667 239.146667L512 795.904l299.52-299.946667a170.666667 170.666667 0 0 0-8.234667-232.704z" fill="#86868b"></path></svg>
                              <svg v-else width="14" height="14" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512 901.746939c-13.583673 0-26.122449-4.179592-37.093878-13.061225-8.881633-7.314286-225.697959-175.020408-312.424489-311.379592C133.746939 532.37551 94.040816 471.24898 94.040816 384.522449c0-144.718367 108.146939-262.269388 240.326531-262.269388 67.395918 0 131.657143 30.82449 177.632653 84.636735 45.453061-54.334694 109.191837-84.636735 177.110204-84.636735 132.702041 0 240.326531 117.55102 240.326531 262.269388 0 85.159184-37.093878 143.673469-67.395919 191.216327l-1.044898 1.567346c-86.726531 136.359184-303.542857 304.587755-312.424489 311.379592-10.44898 8.359184-22.987755 13.061224-36.571429 13.061225z" fill="#E5404F"></path></svg>
                              <span>{{ commentLikes[comment.id] || 0 }}</span>
                            </el-button>
                            <div class="comment-body">
                              <p class="comment-content">{{ comment.content }}</p>
                            </div>
                          </div>
                        </template>
                        <!-- 如果不是当前用户，点赞按钮在右侧外面 -->
                        <template v-else>
                          <div class="comment-avatar-container">
                            <el-avatar
                              :src="avatarDisplayUrl(comment.user?.avatar)"
                              :size="32"
                              class="comment-avatar"
                            />
                            <span class="comment-user">{{ comment.user?.name || '未知用户' }}</span>
                          </div>
                          <div class="comment-body">
                            <p class="comment-content">{{ comment.content }}</p>
                          </div>
                          <el-button
                            text
                            class="comment-action-button like-button-right"
                            :class="{ active: commentLikes[comment.id] > 0 }"
                            @click="likeComment(post.id, comment.id)"
                          >
                            <svg v-if="!(commentLikes[comment.id] > 0)" width="14" height="14" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512.042667 193.237333a255.914667 255.914667 0 0 1 351.658666 9.728 256 256 0 0 1 10.069334 351.402667l-361.813334 362.325333-361.728-362.325333a256 256 0 0 1 361.813334-361.130667z m291.242666 70.016a170.581333 170.581333 0 0 0-234.24-6.528l-56.96 51.114667-57.002666-51.072a170.666667 170.666667 0 0 0-242.602667 239.146667L512 795.904l299.52-299.946667a170.666667 170.666667 0 0 0-8.234667-232.704z" fill="#86868b"></path></svg>
                            <svg v-else width="14" height="14" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M512 901.746939c-13.583673 0-26.122449-4.179592-37.093878-13.061225-8.881633-7.314286-225.697959-175.020408-312.424489-311.379592C133.746939 532.37551 94.040816 471.24898 94.040816 384.522449c0-144.718367 108.146939-262.269388 240.326531-262.269388 67.395918 0 131.657143 30.82449 177.632653 84.636735 45.453061-54.334694 109.191837-84.636735 177.110204-84.636735 132.702041 0 240.326531 117.55102 240.326531 262.269388 0 85.159184-37.093878 143.673469-67.395919 191.216327l-1.044898 1.567346c-86.726531 136.359184-303.542857 304.587755-312.424489 311.379592-10.44898 8.359184-22.987755 13.061224-36.571429 13.061225z" fill="#E5404F"></path></svg>
                            <span>{{ commentLikes[comment.id] || 0 }}</span>
                          </el-button>
                        </template>
                      </div>
                    </div>
                    
                    <!-- 查看更多/收起按钮 -->
                    <div v-if="post.comments && post.comments.length > 2" class="comments-toggle">
                      <el-button text class="comments-toggle-button" @click="toggleComments(post.id)">
                        {{ showAllComments[post.id] ? '收起评论' : `查看更多 ${post.comments.length - 2} 条评论` }}
                      </el-button>
                    </div>
                  </div>
                  
                  <!-- 评论输入 -->
                  <div class="comment-input">
                    <el-avatar :src="avatarDisplayUrl(currentUser.avatar)" :size="32" class="comment-input-avatar" />
                    <el-input
                      v-model="commentInputs[post.id]"
                      placeholder="说点什么..."
                      clearable
                      class="comment-field-input"
                      @keyup.enter="addComment(post.id)"
                    />
                    <el-button
                      type="primary"
                      circle
                      class="send-comment-button"
                      @click="addComment(post.id)"
                      :disabled="!String(commentInputs[post.id] || '').trim()"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 2L11 13M22 2L15 22L11 13M22 2H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 空状态 -->
            <div v-else class="empty-state">
              <svg width="96" height="96" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17 2H7C4.23858 2 2 4.23858 2 7V17C2 19.7614 4.23858 22 7 22H17C19.7614 22 22 19.7614 22 17V7C22 4.23858 19.7614 2 17 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M15 10L12 13L9 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 13V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <h3>{{ searchKeyword.trim() ? '没有找到相关动态' : '暂无动态' }}</h3>
              <p>{{ searchKeyword.trim() ? '试试其他关键词' : '快来发布第一条动态吧！' }}</p>
              <el-button v-if="!searchKeyword.trim()" type="primary" class="post-button" @click="openPostModal">
                发布动态
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <el-dialog
      v-model="showPostModal"
      title="发布动态"
      width="560px"
      class="chat-post-dialog"
      align-center
      append-to-body
      destroy-on-close
      @closed="resetPostModalForm"
    >
      <div class="post-form">
        <div class="post-user-info">
          <el-avatar :src="avatarDisplayUrl(currentUser.avatar)" :size="40" class="user-avatar" />
          <span class="user-name">{{ currentUser.name }}</span>
        </div>
        <el-input
          v-model="postContent"
          type="textarea"
          :rows="4"
          placeholder="分享你的游戏精彩瞬间..."
          class="post-textarea"
        />
        <div class="media-upload-section">
          <div class="media-type-selector">
            <el-button
              text
              class="media-type-button"
              :class="{ active: mediaType === 'image' }"
              @click="mediaType = 'image'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.5 10.5L12 14L15.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 17V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              图片
            </el-button>
            <el-button
              text
              class="media-type-button"
              :class="{ active: mediaType === 'video' }"
              @click="mediaType = 'video'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 3H3C1.89543 3 1 3.89543 1 5V19C1 20.1046 1.89543 21 3 21H21C22.1046 21 23 20.1046 23 19V5C23 3.89543 22.1046 3 21 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M10 8L16 12L10 16V8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              视频
            </el-button>
          </div>
          <el-input
            v-model="postMedia"
            :placeholder="mediaType === 'image' ? '输入图片URL（可选）' : '输入视频URL（可选）'"
            clearable
            class="media-url-input"
          />
        </div>
      </div>
      <template #footer>
        <el-button class="cancel-button" @click="closePostModal">取消</el-button>
        <el-button
          type="primary"
          class="publish-button"
          :loading="isPosting"
          :disabled="!postContent.trim()"
          @click="publishPost"
        >
          {{ isPosting ? '发布中...' : '发布' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showEditModal"
      title="编辑动态"
      width="560px"
      class="chat-edit-dialog"
      align-center
      append-to-body
      destroy-on-close
      @closed="resetEditModalForm"
    >
      <div class="post-form">
        <div class="post-user-info">
          <el-avatar :src="avatarDisplayUrl(currentUser.avatar)" :size="40" class="user-avatar" />
          <span class="user-name">{{ currentUser.name }}</span>
        </div>
        <el-input
          v-model="editContent"
          type="textarea"
          :rows="4"
          placeholder="分享你的游戏精彩瞬间..."
          class="post-textarea"
        />
        <div class="media-upload-section">
          <div class="media-type-selector">
            <el-button
              text
              class="media-type-button"
              :class="{ active: editMediaType === 'image' }"
              @click="editMediaType = 'image'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.5 10.5L12 14L15.5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 17V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              图片
            </el-button>
            <el-button
              text
              class="media-type-button"
              :class="{ active: editMediaType === 'video' }"
              @click="editMediaType = 'video'"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 3H3C1.89543 3 1 3.89543 1 5V19C1 20.1046 1.89543 21 3 21H21C22.1046 21 23 20.1046 23 19V5C23 3.89543 22.1046 3 21 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M10 8L16 12L10 16V8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              视频
            </el-button>
          </div>
          <el-input
            v-model="editMedia"
            :placeholder="editMediaType === 'image' ? '输入图片URL（可选）' : '输入视频URL（可选）'"
            clearable
            class="media-url-input"
          />
        </div>
      </div>
      <template #footer>
        <el-button class="cancel-button" @click="closeEditModal">取消</el-button>
        <el-button
          type="primary"
          class="publish-button"
          :loading="isEditing"
          :disabled="!editContent.trim()"
          @click="saveEdit"
        >
          {{ isEditing ? '保存中...' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 全局样式重置 */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

/* 主容器 */
.circle-container {
  min-height: 100vh;
  background-color: transparent;
}

/* 页面头部 */
.circle-header {
  color: #1d1d1f;
  background-color: #ffffff;
  padding: 1rem 0 1.25rem;
  text-align: center;
}

.circle-header h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.circle-header p {
  font-size: 1.125rem;
  opacity: 0.9;
  max-width: 600px;
  margin: 0 auto;
}

/* 搜索和排序栏 */
.search-sort-bar {
  background-color: white;
  padding: 1rem 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: var(--navbar-height, 60px);
  z-index: 100;
}

.search-sort-bar .container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.search-box {
  flex: 1;
  max-width: 500px;
  display: flex;
  align-items: center;
}

.notification-wrapper {
  position: relative;
  flex-shrink: 0;
}

.notification-button {
  position: relative;
  border-radius: 0;
  min-width: 92px;
  padding-left: 0.875rem;
  padding-right: 0.875rem;
}

.notification-badge {
  margin-left: 0.375rem;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #ff3b30;
  color: #fff;
  font-size: 0.75rem;
  line-height: 18px;
  text-align: center;
  padding: 0 0.25rem;
}

.notification-panel {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: 320px;
  max-height: 360px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  z-index: 1002;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.875rem;
  font-weight: 600;
}

.notification-empty {
  padding: 1rem 0.75rem;
  color: #86868b;
  font-size: 0.875rem;
}

.notification-list {
  max-height: 290px;
  overflow-y: auto;
}

.notification-group-title {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: #86868b;
  background: #fafafa;
  border-bottom: 1px solid #f1f1f1;
}

.notification-item {
  padding: 0.75rem;
  border-bottom: 1px solid #f5f5f7;
}

.notification-item.unread {
  background: #f5f9ff;
}

.notification-content {
  margin: 0;
  font-size: 0.875rem;
  color: #1d1d1f;
}

.notification-count {
  margin-left: 0.35rem;
  color: #0071e3;
  font-weight: 600;
}

.notification-preview {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: #86868b;
}

.search-bar-input {
  width: 100%;
}

.search-prefix-icon {
  color: #86868b;
  display: block;
}

.sort-toggle {
  position: relative;
  display: flex;
  background-color: #f5f5f7;
  border-radius: 0;
  overflow: hidden;
  width: 120px;
  flex-shrink: 0;
}

.sort-button {
  flex: 1;
  margin: 0;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  color: #86868b;
  background: transparent;
  cursor: pointer;
  transition: color 0.3s ease;
  position: relative;
  z-index: 2;
  outline: none;
}

.sort-button:focus {
  outline: none;
  box-shadow: none;
}

.sort-button:hover:not(.active) {
  color: #1d1d1f;
  background: transparent;
}

.sort-button.active {
  color: #ffffff;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 50%;
  height: 100%;
  background-color: #1d1d1f;
  border-radius: 0;
  transform: translateX(0);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
  pointer-events: none;
  will-change: transform;
}

.toggle-slider.hottest {
  transform: translateX(100%);
}

/* 主内容区 */
.main-content {
  padding: 1.25rem 0 0;
}

.main-content .container {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 2rem;
}

/* 左侧边栏 */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.user-card {
  background-color: white;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  text-align: center;
}

.user-card .user-avatar.el-avatar {
  margin: 0 auto 1rem;
}

.user-card h3 {
  margin-bottom: 1rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: #1d1d1f;
}

.post-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.75rem 1.5rem;
  background-color: #1d1d1f;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  width: 100%;
  outline: none;
}

.post-button:hover {
  background-color: #000000;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.post-button:focus {
  outline: none;
  box-shadow: none;
}

.sidebar-info {
  background-color: white;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.sidebar-info h4 {
  margin-bottom: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: #1d1d1f;
}

.sidebar-info p {
  font-size: 0.875rem;
  line-height: 1.5;
  color: #86868b;
}

/* 中间内容区 */
.content-area {
  display: flex;
  flex-direction: column;
}

.posts-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* 帖子卡片 */
.post-card {
  background-color: white;
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  padding: 1.5rem;
  margin: 0 0 16px 0;
  transition: all 0.3s ease;
}

/* 帖子头部 */
.post-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.post-user {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-avatar.el-avatar {
  flex-shrink: 0;
}

.post-user-avatar-click {
  cursor: pointer;
}

.user-info h3 {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1d1d1f;
  text-align: left;
}

.post-time {
  font-size: 0.875rem;
  color: #86868b;
}

.post-actions-dropdown {
  position: relative;
}

.dropdown-button {
  background: none;
  border: none;
  color: #86868b;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: all 0.3s ease;
}

.dropdown-button:hover {
  background-color: #f5f5f7;
  color: #1d1d1f;
}

/* 下拉菜单项 hover 样式 */
.el-dropdown-menu__item:hover {
  background-color: #f5f5f7 !important;
  color: #000000 !important;
  font-weight: 500 !important;
}

/* 帖子内容 */
.post-content {
  margin-bottom: 1.5rem;
  min-height: 60px;
  margin: 0px 4rem;
  background-color: #f5f5f7;
  padding: 1rem;
  border-radius: 8px;
}

.post-content p {
  margin: 0 0 1rem 0;
  line-height: 1.6;
  color: #1d1d1f;
  font-size: 0.9375rem;
  text-align: left;
}

.post-media-container {
  margin-top: 1rem;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  background-color: #f5f5f7;
}

.post-media.image.el-image {
  width: 100%;
  display: block;
  vertical-align: top;
}

.post-media.image :deep(.el-image__inner) {
  width: 100%;
  max-height: 400px;
  object-fit: cover;
}

.post-media.video {
  max-height: 480px;
  aspect-ratio: 16/9;
}

/* 帖子操作 */
.post-actions {
  display: flex;
  gap: 2rem;
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  margin: 0px 4rem;
  align-items: center;
}

/* 删除按钮 */
.delete-button {
  background-color: white;
  color: black;
  border: 1px solid #e0e0e0;
}

.delete-button:hover {
  background-color: #f5f5f7;
  transform: translateY(-1px);
}

.action-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: #86868b;
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.3s ease;
  padding: 0.5rem 0;
  outline: none;
}

.action-button:focus {
  outline: none;
  box-shadow: none;
}

.action-button:hover {
  color: #0071e3;
}

.action-button.active {
  color: #ff3b30;
}

/* 评论区 */
.comments-section {
  margin-top: 1rem;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}

.comment-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  padding-bottom: 1rem;
}

.comment-time-container {
  width: 100%;
  text-align: center;
  margin: 6px 0;
}

.comment-time {
  font-size: 0.75rem;
  color: #999999;
}

.comment-content-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.like-button-left,
.like-button-right {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: #86868b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 0.3s ease;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.like-button-left svg,
.like-button-right svg {
  width: 16px;
  height: 16px;
}

.like-button-left:hover,
.like-button-right:hover {
  color: #1d1d1f;
  background-color: #f5f5f7;
}

.like-button-left.active,
.like-button-right.active {
  color: #0071e3;
}

.comment-body-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.comment-avatar-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.comment-avatar.el-avatar {
  flex-shrink: 0;
}

.comment-user {
  font-size: 0.75rem;
  color: #86868b;
  flex-shrink: 0;
  text-align: center;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comment-body {
  min-width: 50%;
  max-width: 80%;
  background-color: #f5f5f7;
  border-radius: 16px;
  padding: 1rem;
}

/* 当前用户自己的评论样式 */
.own-comment {
  flex-direction: column;
}

.own-comment .comment-content-wrapper {
  flex-direction: row-reverse;
}

.own-comment .comment-body {
  background-color: #e6f0ff;
  color: #1d1d1f;
}

.own-comment .comment-user,
.own-comment .comment-time,
.own-comment .comment-content {
  color: #1d1d1f;
}

.own-comment .comment-body-wrapper {
  justify-content: flex-end;
}

.comment-content {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: #1d1d1f;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
}

.comment-action-button {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: #86868b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 0.3s ease;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.comment-action-button:hover {
  color: #1d1d1f;
  background-color: #f5f5f7;
}

.comment-action-button.active {
  color: #0071e3;
}

.comment-action-button:nth-child(2).active {
  color: #ff3b30;
}

/* 自己评论的操作按钮样式 */
.own-comment .comment-action-button {
  color: #86868b;
}

.own-comment .comment-action-button:hover {
  color: #1d1d1f;
  background-color: rgba(0, 0, 0, 0.1);
}

.own-comment .comment-action-button.active {
  color: #0071e3;
}

.own-comment .comment-action-button:nth-child(2).active {
  color: #ff3b30;
}

/* 查看更多/收起按钮 */
.comments-toggle {
  margin-top: 1rem;
  text-align: center;
}

.comments-toggle-button {
  background: none;
  border: none;
  color: #0071e3;
  font-size: 0.875rem;
  cursor: pointer;
  transition: color 0.3s ease;
  padding: 0.5rem;
  border-radius: 4px;
}

.comments-toggle-button:hover {
  color: #0077ed;
  background-color: rgba(0, 113, 227, 0.05);
}

/* 评论输入 */
.comment-input {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.comment-input-avatar.el-avatar {
  flex-shrink: 0;
}

.comment-field-input {
  flex: 1;
  min-width: 0;
}

.send-comment-button {
  flex-shrink: 0;
  width: 36px !important;
  height: 36px !important;
  padding: 0 !important;
}

.send-comment-button svg {
  display: block;
}

/* 右侧边栏 */
.right-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.trending-section, .online-users {
  background-color: white;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
}

.trending-section h4, .online-users h4 {
  margin-bottom: 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #1d1d1f;
}

.trending-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.trending-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.trending-rank {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f5f5f7;
  color: #86868b;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.trending-item:nth-child(1) .trending-rank {
  background-color: #ff3b30;
  color: white;
}

.trending-item:nth-child(2) .trending-rank {
  background-color: #ff9500;
  color: white;
}

.trending-item:nth-child(3) .trending-rank {
  background-color: #ffcc00;
  color: white;
}

.trending-content h5 {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 0.25rem;
}

.trending-content p {
  font-size: 0.75rem;
  color: #86868b;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.user-name {
  font-size: 0.875rem;
  color: #1d1d1f;
}

/* 发布/编辑弹窗（el-dialog）内表单 */
.post-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.post-user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.post-user-info .user-name {
  font-size: 1rem;
  font-weight: 600;
  color: #1d1d1f;
}

.post-textarea {
  width: 100%;
}

.post-textarea :deep(.el-textarea__inner) {
  resize: none;
  min-height: 120px;
  font-size: 1rem;
}

.media-url-input {
  width: 100%;
}

.media-upload-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.media-type-selector {
  display: flex;
  gap: 0.5rem;
  background-color: #f5f5f7;
  padding: 0.25rem;
  border-radius: 980px;
}

.media-type-button.el-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  height: auto;
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 980px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #86868b;
  transition: all 0.3s ease;
}

.media-type-button.el-button:hover {
  color: #1d1d1f;
  background: transparent;
}

.media-type-button.el-button.active {
  background-color: #ffffff;
  color: #1d1d1f;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.cancel-button.el-button {
  padding: 0.75rem 1.5rem;
  border-radius: 0;
  font-size: 0.875rem;
  font-weight: 500;
  background-color: #f5f5f7;
  color: #1d1d1f;
  border: none;
}

.cancel-button.el-button:hover {
  background-color: #e8e8ed;
  color: #1d1d1f;
}

.publish-button.el-button--primary {
  padding: 0.75rem 1.5rem;
  border-radius: 0;
  font-size: 0.875rem;
  font-weight: 500;
  background-color: #0071e3;
  border-color: #0071e3;
}

.publish-button.el-button--primary:hover:not(.is-disabled) {
  background-color: #0077ed;
  border-color: #0077ed;
}

.publish-button.el-button--primary.is-disabled {
  background-color: #d2d2d7;
  border-color: #d2d2d7;
  cursor: not-allowed;
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  color: #86868b;
  text-align: center;
}

.loading-skeleton-state {
  align-items: stretch;
  padding: 0;
  color: inherit;
}

.post-skeleton-card {
  margin: 0 0 1rem 0;
}

.post-skeleton-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.post-skeleton-avatar {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.post-skeleton-user {
  flex: 1;
}

.post-skeleton-name {
  width: 180px;
  margin-bottom: 0.5rem;
}

.post-skeleton-time {
  width: 120px;
}

.post-skeleton-content {
  background-color: #f5f5f7;
  border-radius: 8px;
  padding: 1rem;
  margin: 0 4rem 1rem;
}

.post-skeleton-line {
  width: 100%;
  margin-bottom: 0.5rem;
}

.post-skeleton-media {
  width: 100%;
  height: 180px;
  border-radius: 8px;
  margin-top: 0.25rem;
}

.post-skeleton-actions {
  margin: 0 4rem 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.post-skeleton-action-btn {
  width: 78px;
}

.post-skeleton-comment {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.post-skeleton-comment-avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.post-skeleton-comment-input {
  flex: 1;
  height: 32px;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid #f5f5f7;
  border-top: 3px solid #0071e3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  color: #ff3b30;
  text-align: center;
  gap: 1rem;
}

.error-state svg {
  color: #ff3b30;
  margin-bottom: 1rem;
}

.retry-button {
  padding: 0.75rem 1.5rem;
  background-color: #1d1d1f;
  color: #ffffff;
  border: none;
  border-radius: 980px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-top: 1rem;
}

.retry-button:hover {
  background-color: #000000;
  transform: translateY(-2px);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  color: #86868b;
  text-align: center;
  gap: 1rem;
}

.empty-state svg {
  color: #86868b;
  margin-bottom: 1rem;
}

.empty-state h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 0.5rem;
}

.empty-state p {
  font-size: 0.875rem;
  color: #86868b;
  margin-bottom: 1.5rem;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .main-content .container {
    grid-template-columns: 200px 1fr 200px;
    gap: 1.5rem;
  }
  
  .user-card .user-avatar.el-avatar {
    width: 64px !important;
    height: 64px !important;
  }
  
  .post-button {
    padding: 0.625rem 1.25rem;
    font-size: 0.875rem;
  }
}

@media (max-width: 768px) {
  .main-content .container {
    grid-template-columns: 1fr;
  }
  
  .sidebar,
  .right-sidebar {
    display: none;
  }
  
  .search-sort-bar .container {
    flex-direction: column;
    align-items: stretch;
  }
  
  .search-box {
    max-width: 100%;
  }
  
  .sort-options {
    justify-content: center;
  }
  
  .circle-header {
    padding: 0.875rem 0 1rem;
  }
  
  .circle-header h1 {
    font-size: 2rem;
  }
  
  .posts-list {
    padding: 0 1rem;
  }
  
  .post-card {
    padding: 1.25rem;
  }

  .post-skeleton-content,
  .post-skeleton-actions {
    margin-left: 0;
    margin-right: 0;
  }
  
  .post-actions {
    gap: 1.5rem;
  }
  
  .post-user-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}

@media (max-width: 480px) {
  .circle-header {
    padding: 0.75rem 0 0.875rem;
  }
  
  .circle-header h1 {
    font-size: 1.75rem;
  }
  
  .circle-header p {
    font-size: 0.875rem;
    padding: 0 1rem;
  }
  
  .search-sort-bar {
    top: var(--navbar-height, 60px);
  }
  
  .post-card {
    padding: 1rem;
  }

  .post-skeleton-media {
    height: 140px;
  }
  
  .post-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .post-actions {
    gap: 1rem;
  }
  
  .comment-input {
    gap: 0.5rem;
  }
}
</style>

<style>
/* 发布/编辑弹窗 teleport 到 body，用全局选择器保持圆角与留白 */
.chat-post-dialog.el-dialog,
.chat-edit-dialog.el-dialog {
  border-radius: 16px;
  padding: 0;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.chat-post-dialog .el-dialog__header,
.chat-edit-dialog .el-dialog__header {
  position: relative;
  margin-right: 0;
  box-sizing: border-box;
  min-height: 68px;
  padding: 1rem 3.25rem 1rem 1.5rem;
  display: flex;
  align-items: center;
}

.chat-post-dialog .el-dialog__headerbtn,
.chat-edit-dialog .el-dialog__headerbtn {
  position: absolute !important;
  top: 50% !important;
  right: 0.875rem !important;
  width: 32px !important;
  height: 32px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: #606266 !important;
  z-index: 2;
  margin: 0 !important;
  transform: translateY(-50%) !important;
}

.chat-post-dialog .el-dialog__headerbtn .el-dialog__close,
.chat-edit-dialog .el-dialog__headerbtn .el-dialog__close {
  font-size: 18px;
}

.chat-post-dialog .el-dialog__title,
.chat-edit-dialog .el-dialog__title {
  margin: 0;
  padding: 0;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.25;
  color: #1d1d1f;
}

.chat-post-dialog .el-dialog__body,
.chat-edit-dialog .el-dialog__body {
  padding: 0.5rem 1.5rem 1rem;
}

.chat-post-dialog .el-dialog__footer,
.chat-edit-dialog .el-dialog__footer {
  padding: 0 1.5rem 1.25rem;
}
</style>