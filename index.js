const express = require('express')
const cors = require('cors')
const https = require('https')

const app = express()

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 云开发配置
const CLOUD_ENV = process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa'
const REST_API_BASE = `https://${CLOUD_ENV}.service.tcloudbase.com`

// 通过云开发 REST API 访问数据库
async function callRestApi(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(REST_API_BASE + path)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }
    
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          resolve(json)
        } catch (e) {
          resolve({ success: true, data: body })
        }
      })
    })
    
    req.on('error', reject)
    
    if (data) {
      req.write(JSON.stringify(data))
    }
    req.end()
  })
}

// 数据库操作封装
async function dbList(collection, query = {}, page = 1, pageSize = 50) {
  const skip = (page - 1) * pageSize
  let path = `/db/${collection}?skip=${skip}&limit=${pageSize}`
  
  if (Object.keys(query).length > 0) {
    path += `&where=${encodeURIComponent(JSON.stringify(query))}`
  }
  
  return callRestApi(path, 'GET')
}

async function dbCount(collection, query = {}) {
  let path = `/db/${collection}/count`
  if (Object.keys(query).length > 0) {
    path += `?where=${encodeURIComponent(JSON.stringify(query))}`
  }
  return callRestApi(path, 'GET')
}

async function dbAdd(collection, data) {
  const path = `/db/${collection}`
  return callRestApi(path, 'POST', data)
}

async function dbUpdate(collection, docId, data) {
  const path = `/db/${collection}/${docId}`
  return callRestApi(path, 'PUT', data)
}

async function dbDelete(collection, docId) {
  const path = `/db/${collection}/${docId}`
  return callRestApi(path, 'DELETE')
}

// 健康检查（必须快速响应）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
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
          const loginRes = await dbList('admins', { username, password }, 1, 1)
          const list = loginRes.data || loginRes.data?.list || []
          if (list.length > 0 || (Array.isArray(loginRes.data) && loginRes.data.length > 0)) {
            const admin = Array.isArray(loginRes.data) ? loginRes.data[0] : loginRes.data
            result = {
              success: true,
              token: 'admin_' + (admin._id || Date.now()),
              admin: { username: admin.username || username, role: admin.role || 'admin' }
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
        let dbQuery = { ...query }
        
        // 处理 datePrefix
        if (dbQuery.datePrefix) {
          const prefix = dbQuery.datePrefix
          delete dbQuery.datePrefix
          dbQuery.date = dbQuery.date || {}
          dbQuery.date = { $regex: '^' + prefix }
        }
        
        const listRes = await dbList(collection, dbQuery, page, pageSize)
        const countRes = await dbCount(collection, dbQuery)
        const total = countRes.total || countRes.data?.total || 0
        
        result = { 
          success: true, 
          data: listRes.data || listRes.list || [], 
          total: total, 
          page, 
          pageSize 
        }
      }

      // count 查询
      else if (action === 'count') {
        const countRes = await dbCount(collection, query)
        result = { success: true, total: countRes.total || countRes.data?.total || 0 }
      }

      // stats 统计
      else if (action === 'stats') {
        const collections = ['chapters', 'exams', 'wrongQuestions', 'practiceRecords', 'examRecords', 'users', 'trainingPlans', 'teachers', 'planes']
        const stats = {}
        for (const col of collections) {
          try {
            const res = await dbCount(col)
            stats[col] = res.total || res.data?.total || 0
          } catch (e) {
            stats[col] = 0
          }
        }
        // 计算总题目数
        let totalQuestions = 0
        try {
          const chaptersRes = await dbList('chapters', {}, 1, 100)
          const chapters = chaptersRes.data || chaptersRes.list || []
          chapters.forEach(ch => { totalQuestions += (ch.questions || []).length })
        } catch (e) {}
        stats.totalQuestions = totalQuestions
        result = { success: true, stats }
      }

      // add 添加
      else if (action === 'add') {
        const res = await dbAdd(collection, { ...data, createdAt: Date.now() })
        result = { success: true, _id: res._id || res.data?._id }
      }

      // update 更新
      else if (action === 'update') {
        if (!docId) {
          result = { success: false, error: '缺少 docId' }
        } else {
          await dbUpdate(collection, docId, { ...data, updatedAt: Date.now() })
          result = { success: true }
        }
      }

      // delete 删除
      else if (action === 'delete') {
        if (!docId) {
          result = { success: false, error: '缺少 docId' }
        } else {
          await dbDelete(collection, docId)
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
              await dbDelete(collection, id)
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
          await dbUpdate('trainingPlans', docId, { 
            status: 'confirmed', 
            confirmedAt: Date.now() 
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

// 启动服务器
const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器启动成功，监听端口 ${PORT}`)
  console.log(`云开发环境: ${CLOUD_ENV}`)
})
