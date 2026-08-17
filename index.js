const express = require('express')
const https = require('https')

// 云函数 HTTP 端点地址
const ENV_ID = process.env.CLOUD_ENV || 'cloud1-d9gcbuql8f6a0bbaa'
const CLOUD_FUNCTION_URL = `https://${ENV_ID}.service.tcloudbase.com/adminDataHttp`

console.log('[初始化] 云函数代理地址:', CLOUD_FUNCTION_URL)

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
  res.json({ status: 'ok', timestamp: Date.now(), mode: 'proxy' })
})

// 代理转发函数
function proxyToCloudFunction(data) {
  return new Promise((resolve, reject) => {
    const url = new URL(CLOUD_FUNCTION_URL)
    const postData = JSON.stringify(data)

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }

    console.log('[代理] 转发请求到:', CLOUD_FUNCTION_URL)
    console.log('[代理] 请求体:', data)

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          console.log('[代理] 响应成功:', res.statusCode)
          resolve(result)
        } catch (e) {
          console.log('[代理] 响应原始:', body.substring(0, 200))
          resolve({ success: false, error: '响应解析失败', raw: body.substring(0, 200) })
        }
      })
    })

    req.on('error', (e) => {
      console.error('[代理] 请求失败:', e.message)
      reject(e)
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    req.write(postData)
    req.end()
  })
}

// 统一 API 入口 - 代理模式
app.post('/api', async (req, res) => {
  try {
    const data = req.body
    const result = await proxyToCloudFunction(data)
    res.json(result)
  } catch (err) {
    console.error('[API错误]', err)
    res.status(502).json({
      success: false,
      error: '云函数调用失败',
      detail: err.message
    })
  }
})

// 启动服务器
const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器启动成功，监听端口 ${PORT}`)
  console.log(`代理模式: 转发到 ${CLOUD_FUNCTION_URL}`)
})
