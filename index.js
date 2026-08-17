const express = require('express')

// 初始化云开发 SDK
const cloud = require('wx-server-sdk')
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa'

console.log('[初始化] 云开发环境:', ENV_ID)

try {
  cloud.init({ env: ENV_ID })
  console.log('[初始化] 云开发 SDK 初始化成功')
} catch (e) {
  console.error('[初始化] 云开发 SDK 初始化失败:', e.message)
}

const app = express()
let db = null
let _ = null

try {
  db = cloud.database()
  _ = db.command
  console.log('[初始化] 数据库连接成功')
} catch (e) {
  console.error('[初始化] 数据库连接失败:', e.message)
}

// ========== CORS 配置（关键！）==========
// 在所有响应中添加 CORS 头，包括错误响应
app.use((req, res, next) => {
  // 允许所有来源（CORS 核心配置）- 必须在最前面设置
  res.header('Access-Control-Allow-Origin', '*')
  // 允许的 HTTP 方法
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  // 允许的请求头
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  // 预检请求有效期
  res.header('Access-Control-Max-Age', '86400')
  // 暴露响应头（重要！）
  res.header('Access-Control-Expose-Headers', 'Content-Length')

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    console.log('[CORS] OPTIONS 预检请求 - 已处理')
    return res.status(204).send('OK')
  }

  next()
})

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }))

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('[错误]', err)
  res.status(500).json({
    success: false,
    error: err.message || '服务器内部错误'
  })
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    dbAvailable: db !== null,
    env: ENV_ID
  })
})

// 数据库测试
app.get('/test-db', async (req, res) => {
  try {
    if (!db) {
      return res.json({ success: false, error: '数据库未初始化' })
    }
    // 尝试查询一个小的集合
    const result = await db.collection('chapters').limit(1).get()
    res.json({ 
      success: true, 
      message: '数据库连接成功',
      dataCount: result.data.length
    })
  } catch (e) {
    console.error('[数据库测试失败]', e)
    res.json({ 
      success: false, 
      error: e.message,
      hint: '可能原因：1. 免费版限制 2. 网络问题 3. 环境ID错误'
    })
  }
})

// 统一 API 入口
app.post('/api', async (req, res) => {
  const { action, collection, data, query = {}, docId, page = 1, pageSize = 50 } = req.body
  let result

  try {
    // ===== 登录 =====
    if (action === 'login') {
      const { username, password } = req.body
      if (!username || !password) {
        result = { success: false, error: '请输入账号和密码' }
      } else {
        try {
          const loginRes = await db.collection('admins').where({ username, password }).limit(1).get()
          if (loginRes.data.length > 0) {
            const admin = loginRes.data[0]
            result = {
              success: true,
              token: 'admin_' + admin._id + '_' + Date.now(),
              admin: { username: admin.username, role: admin.role || 'admin' }
            }
          } else if (username === 'admin' && password === 'admin123') {
            result = {
              success: true,
              token: 'admin_default_' + Date.now(),
              admin: { username: 'admin', role: 'super' }
            }
          } else {
            result = { success: false, error: '账号或密码错误' }
          }
        } catch (e) {
          if (username === 'admin' && password === 'admin123') {
            result = {
              success: true,
              token: 'admin_default_' + Date.now(),
              admin: { username: 'admin', role: 'super' }
            }
          } else {
            result = { success: false, error: '账号或密码错误' }
          }
        }
      }
    }

    // ===== 数据操作 =====
    else if (collection) {
      // list 查询
      if (action === 'list') {
        const skip = (page - 1) * pageSize
        let dbQuery = db.collection(collection)

        // 处理 datePrefix（用于按月查询训练报备）
        if (query.datePrefix) {
          const prefix = query.datePrefix
          delete query.datePrefix
          query.date = db.RegExp({ regexp: '^' + prefix, options: 'i' })
        }

        // 处理 in 查询
        Object.keys(query).forEach(key => {
          if (query[key] && typeof query[key] === 'object' && query[key].in) {
            query[key] = _.in(query[key].in)
          }
        })

        if (Object.keys(query).length > 0) {
          dbQuery = dbQuery.where(query)
        }

        const countRes = await dbQuery.count()
        const listRes = await dbQuery.skip(skip).limit(pageSize).get()

        result = {
          success: true,
          data: listRes.data,
          total: countRes.total,
          page,
          pageSize
        }
      }

      // count 查询
      else if (action === 'count') {
        let dbQuery = db.collection(collection)
        if (query && Object.keys(query).length > 0) {
          dbQuery = dbQuery.where(query)
        }
        const countRes = await dbQuery.count()
        result = { success: true, total: countRes.total }
      }

      // stats 统计
      else if (action === 'stats') {
        const collections = ['chapters', 'exams', 'wrongQuestions', 'practiceRecords', 'examRecords', 'users', 'trainingPlans', 'teachers', 'planes']
        const stats = {}
        for (const col of collections) {
          try {
            const res = await db.collection(col).count()
            stats[col] = res.total
          } catch (e) {
            stats[col] = 0
          }
        }
        // 计算总题目数
        let totalQuestions = 0
        try {
          const chaptersRes = await db.collection('chapters').get()
          chaptersRes.data.forEach(ch => { totalQuestions += (ch.questions || []).length })
        } catch (e) {}
        stats.totalQuestions = totalQuestions
        result = { success: true, stats }
      }

      // add 添加
      else if (action === 'add') {
        const res = await db.collection(collection).add({ data: { ...data, createdAt: new Date() } })
        result = { success: true, _id: res._id }
      }

      // update 更新
      else if (action === 'update') {
        if (!docId) {
          result = { success: false, error: '缺少 docId' }
        } else {
          await db.collection(collection).doc(docId).update({ data: { ...data, updatedAt: new Date() } })
          result = { success: true }
        }
      }

      // delete 删除
      else if (action === 'delete') {
        if (!docId) {
          result = { success: false, error: '缺少 docId' }
        } else {
          await db.collection(collection).doc(docId).remove()
          result = { success: true }
        }
      }

      // batchDelete 批量删除
      else if (action === 'batchDelete') {
        const ids = Array.isArray(docId) ? docId : []
        if (ids.length === 0) {
          result = { success: false, error: '缺少 docId 数组' }
        } else {
          const results = []
          for (const id of ids) {
            try {
              await db.collection(collection).doc(id).remove()
              results.push({ id, success: true })
            } catch (e) {
              results.push({ id, success: false, error: e.message })
            }
          }
          result = { success: true, results }
        }
      }

      // confirmTraining 确认训练
      else if (action === 'confirmTraining') {
        if (!docId) {
          result = { success: false, error: '缺少 docId' }
        } else {
          await db.collection('trainingPlans').doc(docId).update({
            data: { status: 'confirmed', confirmedAt: new Date() }
          })
          result = { success: true }
        }
      }

      // importQuestions 批量导入题目
      else if (action === 'importQuestions') {
        const { subject, chapters, mode = 'merge' } = req.body
        if (!subject || !Array.isArray(chapters)) {
          result = { success: false, error: '参数错误' }
        } else {
          const results = { created: 0, updated: 0, totalQuestions: 0, skipped: 0, errors: [] }
          for (const chapterData of chapters) {
            try {
              const { name, questions = [] } = chapterData
              if (!name) { results.errors.push('章节名称不能为空'); continue }
              const existing = await db.collection('chapters').where({ name, subject }).get()
              if (existing.data.length > 0) {
                const chapter = existing.data[0]
                if (mode === 'skip') { results.skipped++; continue }
                const existingQuestions = chapter.questions || []
                const existingSet = new Set(existingQuestions.map(q => q.question))
                const newQuestions = questions.filter(q => !existingSet.has(q.question))
                if (newQuestions.length > 0) {
                  const merged = [...existingQuestions, ...newQuestions]
                  await db.collection('chapters').doc(chapter._id).update({
                    data: { questions: merged, questionCount: merged.length, updatedAt: new Date() }
                  })
                  results.updated++
                  results.totalQuestions += newQuestions.length
                } else { results.skipped++ }
              } else {
                await db.collection('chapters').add({
                  data: { name, subject, questions: questions.map(q => ({ ...q, createdAt: new Date() })), questionCount: questions.length, createdAt: new Date(), updatedAt: new Date() }
                })
                results.created++
                results.totalQuestions += questions.length
              }
            } catch (err) {
              results.errors.push(`章节「${chapterData.name || '未知'}」失败: ${err.message}`)
            }
          }
          result = { success: true, results }
        }
      }

      else {
        result = { success: false, error: '未知操作: ' + action }
      }
    }

    // ===== 其他操作 =====
    else if (action === 'ping') {
      result = { success: true, message: 'pong', timestamp: Date.now() }
    }

    else {
      result = { success: false, error: '缺少 action 或 collection 参数' }
    }
  } catch (err) {
    console.error('处理失败:', err)
    result = { success: false, error: err.message }
  }

  res.json(result)
})

// 启动服务器
const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器启动成功，监听端口 ${PORT}`)
  console.log(`云开发环境: ${process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa'}`)
})
