const express = require('express')
const cors = require('cors')
const cloud = require('wx-server-sdk')

// 初始化云开发
cloud.init({ 
  env: process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa',
  traceUser: true
})

const db = cloud.database()
const _ = db.command
const app = express()

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
        // 查询数据库
        try {
          const adminRes = await db.collection('admins').where({ username, password }).get()
          if (adminRes.data.length > 0) {
            const admin = adminRes.data[0]
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
          // admins 集合不存在，使用默认管理员
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
        
        // 处理 datePrefix
        if (query.datePrefix) {
          const prefix = query.datePrefix
          delete query.datePrefix
          query.date = db.RegExp({ regexp: '^' + prefix, options: 'i' })
        }
        
        // 处理 in 查询
        Object.keys(query).forEach(key => {
          if (query[key] && typeof query[key] === 'object' && query[key].in) {
            query[key] = db.command.in(query[key].in)
          }
        })
        
        if (Object.keys(query).length > 0) {
          dbQuery = dbQuery.where(query)
        }
        
        // 排序
        if (query.orderBy) {
          const { field, order } = query.orderBy
          delete query.orderBy
          dbQuery = dbQuery.orderBy(field, order || 'desc')
        }
        
        const countRes = await dbQuery.count()
        const listRes = await dbQuery.skip(skip).limit(pageSize).get()
        result = { success: true, data: listRes.data, total: countRes.total, page, pageSize }
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

// 启动服务
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`)
})
