const express = require('express')
const cloud = require('wx-server-sdk')

// 初始化云开发 SDK
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa'
console.log('[初始化] 云开发环境:', ENV_ID)

try {
  cloud.init({ env: ENV_ID })
  console.log('[初始化] 云开发 SDK 初始化成功')
} catch (e) {
  console.error('[初始化] 云开发 SDK 初始化失败:', e.message)
}

const db = cloud.database()
const _ = db.command

const app = express()

// ========== CORS 配置 ==========
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  res.header('Access-Control-Max-Age', '86400')

  if (req.method === 'OPTIONS') {
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
  res.json({ status: 'ok', timestamp: Date.now(), mode: 'direct' })
})

// ========== 数据库操作函数 ==========
async function handleRequest(data) {
  const { action, collection, ...params } = data

  console.log(`[请求] action=${action}, collection=${collection}`)

  try {
    switch (action) {
      case 'list':
        return await listData(collection, params)
      case 'detail':
        return await getDetail(collection, params)
      case 'add':
        return await addData(collection, params)
      case 'update':
        return await updateData(collection, params)
      case 'delete':
        return await deleteData(collection, params)
      case 'count':
        return await countData(collection, params)
      case 'aggregate':
        return await aggregateData(collection, params)
      case 'login':
        return await handleLogin(params)
      default:
        return { success: false, error: `未知的操作: ${action}` }
    }
  } catch (err) {
    console.error(`[数据库错误]`, err)
    return { success: false, error: err.message }
  }
}

async function listData(collection, params) {
  const { query = {}, pageSize = 100, page = 1, sort = {} } = params
  try {
    const collectionRef = db.collection(collection)
    const countResult = await collectionRef.where(query).count()
    const total = countResult.total

    let queryRef = collectionRef.where(query)
    if (Object.keys(sort).length > 0) {
      queryRef = queryRef.orderBy(Object.keys(sort)[0], sort[Object.keys(sort)[0]])
    }

    const skip = (page - 1) * pageSize
    const result = await queryRef.skip(skip).limit(pageSize).get()

    return {
      success: true,
      data: result.data,
      total: total,
      page: page,
      pageSize: pageSize
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function getDetail(collection, params) {
  const { id } = params
  try {
    const result = await db.collection(collection).doc(id).get()
    return { success: true, data: result.data }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function addData(collection, params) {
  const { data } = params
  try {
    const result = await db.collection(collection).add({ data })
    return { success: true, _id: result._id }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function updateData(collection, params) {
  const { id, data } = params
  try {
    await db.collection(collection).doc(id).update({ data })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function deleteData(collection, params) {
  const { id } = params
  try {
    await db.collection(collection).doc(id).remove()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function countData(collection, params) {
  const { query = {} } = params
  try {
    const result = await db.collection(collection).where(query).count()
    return { success: true, total: result.total }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function aggregateData(collection, params) {
  const { pipeline = [] } = params
  try {
    const result = await db.collection(collection).aggregate(pipeline)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function handleLogin(params) {
  const { username, password } = params
  try {
    const result = await db.collection('admins')
      .where({ username, password })
      .get()
    
    if (result.data.length > 0) {
      return { 
        success: true, 
        token: 'admin-token-' + Date.now(),
        user: result.data[0]
      }
    }
    return { success: false, error: '用户名或密码错误' }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 统一 API 入口
app.post('/api', async (req, res) => {
  try {
    const data = req.body
    console.log('[API请求]:', JSON.stringify(data).substring(0, 200))
    const result = await handleRequest(data)
    res.json(result)
  } catch (err) {
    console.error('[API错误]', err)
    res.status(500).json({
      success: false,
      error: '服务器内部错误',
      detail: err.message
    })
  }
})

// 启动服务器
const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器启动成功，监听端口 ${PORT}`)
  console.log(`直接数据库模式: 访问云数据库`)
})
