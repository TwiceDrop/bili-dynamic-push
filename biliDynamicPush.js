import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import plugin from '../../lib/plugins/plugin.js'

const pluginName = 'B站动态推送'
const dataDir = path.join(process.cwd(), 'data', 'bili-dynamic-push')
const configFile = path.join(dataDir, 'config.json')

const defaultConfig = {
  biliCookie: '',
  visitorCookie: {
    value: '',
    expireAt: 0
  },
  groups: {}
}

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'sec-ch-ua': '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  origin: 'https://www.bilibili.com',
  referer: 'https://www.bilibili.com/'
}

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13
]

let wbiKeyCache = {
  key: '',
  expireAt: 0
}

let visitorCookieCache = {
  value: '',
  expireAt: 0
}

class BiliDynamicError extends Error {
  constructor (brief, detail, options = {}) {
    super(detail || brief)
    this.name = 'BiliDynamicError'
    this.brief = brief
    this.detail = detail || brief
    this.code = options.code
    this.url = options.url
  }
}

export class biliDynamicPush extends plugin {
  constructor () {
    super({
      name: pluginName,
      dsc: '群聊自动推送指定 UP 主 B 站动态',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(帮助|help)$',
          fnc: 'help'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(cookie|Cookie|CK|ck)(设置|set)\\s*(.+)$',
          fnc: 'setCookie'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(cookie|Cookie|CK|ck)(删除|清除|del|rm)$',
          fnc: 'deleteCookie'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(cookie|Cookie|CK|ck)(状态|status)$',
          fnc: 'cookieStatus'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(添加|新增|add)\\s*([0-9]+)$',
          fnc: 'addUid'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(删除|移除|del|rm)\\s*([0-9]+)$',
          fnc: 'removeUid'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(列表|list)$',
          fnc: 'listUids'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(@全体|at全体|全体)\\s*(开启|打开|启用|on|关闭|禁用|off)$',
          fnc: 'setAtAll'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(@成员|at成员)\\s*(添加|新增|add|删除|移除|del|rm)\\s*(\\d+)$',
          fnc: 'setAtMember'
        },
        {
          reg: '^#?(B站|b站|哔哩|Bili|bili)?动态推送(@成员|at成员)(列表|list)$',
          fnc: 'listAtMembers'
        }
      ]
    })

    this.task = {
      name: `${pluginName}检查`,
      cron: '0 */2 * * * ?',
      fnc: () => this.checkAllGroups()
    }
  }

  async help (e) {
    await e.reply([
      `${pluginName}命令：`,
      '#动态推送添加 123456',
      '#动态推送删除 123456',
      '#动态推送列表',
      '#动态推送@全体 开启/关闭',
      '#动态推送@成员 添加 10001',
      '#动态推送@成员 删除 10001',
      '#动态推送@成员列表',
      '#动态推送cookie设置 SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx',
      '#动态推送cookie状态',
      '#动态推送cookie删除',
      '以上设置命令仅主人可用。'
    ].join('\n'))
    return true
  }

  async setCookie (e) {
    if (!await this.checkMasterOnly(e)) return true

    const cookie = normalizeCookie(e.msg.replace(/^#?(B站|b站|哔哩|Bili|bili)?动态推送(cookie|Cookie|CK|ck)(设置|set)\s*/i, ''))
    if (!cookie || !cookie.includes('=')) {
      await e.reply('Cookie 格式不正确。')
      return true
    }

    const config = loadConfig()
    config.biliCookie = cookie
    saveConfig(config)
    wbiKeyCache = { key: '', expireAt: 0 }

    await e.reply('B站 Cookie 已保存，后续动态请求会优先使用该 Cookie。')
    return true
  }

  async deleteCookie (e) {
    if (!await this.checkMasterOnly(e)) return true

    const config = loadConfig()
    config.biliCookie = ''
    saveConfig(config)
    wbiKeyCache = { key: '', expireAt: 0 }

    await e.reply('B站 Cookie 已删除，后续将使用游客 Cookie。')
    return true
  }

  async cookieStatus (e) {
    if (!await this.checkMasterOnly(e)) return true

    const config = loadConfig()
    await e.reply(`B站 Cookie：${config.biliCookie ? '已配置' : '未配置'}\n游客 Cookie：${config.visitorCookie?.value ? '已缓存' : '未缓存'}`)
    return true
  }

  async addUid (e) {
    if (!await this.checkMasterAndGroup(e)) return true

    const uid = e.msg.match(/(\d+)$/)?.[1]
    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)

    if (group.uids[uid]) {
      await e.reply(`UID ${uid} 已在本群动态推送列表中。`)
      return true
    }

    let latest
    try {
      latest = await fetchLatestDynamic(uid)
    } catch (error) {
      await replyBriefAndPrivate(e, `添加 UID ${uid} 失败`, error)
      return true
    }

    if (!latest) {
      await e.reply(`没有获取到 UID ${uid} 的公开动态，请稍后重试。`)
      return true
    }

    group.uids[uid] = {
      name: latest.name || uid,
      lastDynamicId: latest.id,
      lastCheck: Date.now()
    }
    saveConfig(config)

    await e.reply(`已添加 ${group.uids[uid].name}（UID ${uid}），并以当前最新动态作为推送基线。`)
    return true
  }

  async removeUid (e) {
    if (!await this.checkMasterAndGroup(e)) return true

    const uid = e.msg.match(/(\d+)$/)?.[1]
    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)

    if (!group.uids[uid]) {
      await e.reply(`UID ${uid} 不在本群动态推送列表中。`)
      return true
    }

    const name = group.uids[uid].name || uid
    delete group.uids[uid]
    saveConfig(config)

    await e.reply(`已删除 ${name}（UID ${uid}）。`)
    return true
  }

  async listUids (e) {
    if (!e.isGroup) {
      await e.reply('请在群聊中查看动态推送列表。')
      return true
    }

    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)
    const list = Object.entries(group.uids)

    if (!list.length) {
      await e.reply('本群还没有设置动态推送 UID。')
      return true
    }

    await e.reply([
      '本群动态推送列表：',
      ...list.map(([uid, info]) => `${info.name || '未知UP'}：${uid}`),
      `@全体：${group.atAll ? '开启' : '关闭'}`,
      `@成员：${group.atMembers.length ? group.atMembers.join('、') : '无'}`
    ].join('\n'))
    return true
  }

  async setAtAll (e) {
    if (!await this.checkMasterAndGroup(e)) return true

    const enabled = /(开启|打开|启用|on)$/i.test(e.msg.trim())
    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)

    group.atAll = enabled
    saveConfig(config)

    await e.reply(`动态推送 @全体 已${enabled ? '开启' : '关闭'}。`)
    return true
  }

  async setAtMember (e) {
    if (!await this.checkMasterAndGroup(e)) return true

    const match = e.msg.match(/(@成员|at成员)\s*(添加|新增|add|删除|移除|del|rm)\s*(\d+)$/i)
    const action = match?.[2]
    const qq = match?.[3]
    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)
    const shouldAdd = /^(添加|新增|add)$/i.test(action)

    if (shouldAdd) {
      if (!group.atMembers.includes(qq)) group.atMembers.push(qq)
      await e.reply(`动态推送将 @ ${qq}。`)
    } else {
      group.atMembers = group.atMembers.filter(member => member !== qq)
      await e.reply(`动态推送不再 @ ${qq}。`)
    }

    saveConfig(config)
    return true
  }

  async listAtMembers (e) {
    if (!e.isGroup) {
      await e.reply('请在群聊中查看 @成员 列表。')
      return true
    }

    const config = loadConfig()
    const group = getGroupConfig(config, e.group_id)
    await e.reply(`本群动态推送 @成员：${group.atMembers.length ? group.atMembers.join('、') : '无'}`)
    return true
  }

  async checkMasterOnly (e) {
    if (!e.isMaster) {
      await e.reply('只有主人可以设置动态推送。')
      return false
    }

    return true
  }

  async checkMasterAndGroup (e) {
    if (!e.isMaster) {
      await e.reply('只有主人可以设置动态推送。')
      return false
    }

    if (!e.isGroup) {
      await e.reply('请在需要接收推送的群聊中设置。')
      return false
    }

    return true
  }

  async checkAllGroups () {
    const config = loadConfig()
    const groupEntries = Object.entries(config.groups || {})

    for (const [groupId, group] of groupEntries) {
      const uidEntries = Object.entries(group.uids || {})
      if (!uidEntries.length) continue

      for (const [uid, info] of uidEntries) {
        try {
          const dynamics = await fetchDynamics(uid)
          if (!dynamics.length) continue

          const latestAuthorName = dynamics[0]?.name
          if (latestAuthorName) info.name = latestAuthorName

          if (!info.lastDynamicId) {
            info.lastDynamicId = dynamics[0].id
            info.lastCheck = Date.now()
            saveConfig(config)
            continue
          }

          const pending = dynamics
            .filter(item => compareDynamicId(item.id, info.lastDynamicId) > 0)
            .reverse()

          for (const dynamic of pending) {
            await this.pushDynamic(groupId, group, dynamic)
            info.lastDynamicId = dynamic.id
            info.name = dynamic.name || info.name
            info.lastCheck = Date.now()
            saveConfig(config)
          }
        } catch (error) {
          logger.warn(`[${pluginName}] 检查 UID ${uid} 失败：${error?.message || error}`)
        }
      }
    }
  }

  async pushDynamic (groupId, group, dynamic) {
    const msg = []

    if (group.atAll) msg.push(segment.at('all'))
    for (const qq of group.atMembers || []) msg.push(segment.at(Number(qq)))

    const image = await renderDynamicUiImage(dynamic)
    if (msg.length) msg.push('\n')
    if (image) {
      msg.push(image)
      msg.push('\n')
    }
    msg.push(`${dynamic.name || '未知UP主'}的动态 ${dynamic.url}`)

    await Bot.pickGroup(Number(groupId)).sendMsg(msg)
  }
}

function loadConfig () {
  ensureDataDir()

  if (!fs.existsSync(configFile)) {
    saveConfig(defaultConfig)
    return structuredClone(defaultConfig)
  }

  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    config.biliCookie ||= ''
    config.visitorCookie ||= { value: '', expireAt: 0 }
    config.groups ||= {}
    return config
  } catch (error) {
    logger.error(`[${pluginName}] 读取配置失败：${error?.message || error}`)
    return structuredClone(defaultConfig)
  }
}

function saveConfig (config) {
  ensureDataDir()
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function ensureDataDir () {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function getGroupConfig (config, groupId) {
  const id = String(groupId)
  config.groups ||= {}
  config.groups[id] ||= {
    uids: {},
    atAll: false,
    atMembers: []
  }
  config.groups[id].uids ||= {}
  config.groups[id].atAll ||= false
  config.groups[id].atMembers ||= []
  return config.groups[id]
}

async function replyBriefAndPrivate (e, title, error) {
  const brief = error?.brief || '处理失败，请稍后再试。'
  await e.reply(`${title}：${brief}\n详细错误已私聊主人。`)

  const detail = [
    `【${pluginName}】${title}`,
    `群号：${e.group_id || '私聊'}`,
    `QQ：${e.user_id || '未知'}`,
    `消息：${e.msg || ''}`,
    '',
    formatErrorDetail(error)
  ].join('\n')

  const sent = await sendPrivateMsg(e.user_id, detail)
  if (!sent) logger.warn(`[${pluginName}] 私聊发送错误详情失败：${error?.message || error}`)
}

async function sendPrivateMsg (userId, msg) {
  const qq = Number(userId)
  if (!qq) return false

  const bot = globalThis.Bot
  const senders = [
    () => bot?.pickFriend?.(qq)?.sendMsg(msg),
    () => bot?.pickUser?.(qq)?.sendMsg(msg),
    () => bot?.sendPrivateMsg?.(qq, msg)
  ]

  for (const sender of senders) {
    try {
      const result = sender()
      if (!result) continue
      await result
      return true
    } catch {}
  }

  return false
}

function formatErrorDetail (error) {
  if (!error) return '未知错误'

  const lines = []
  if (error.code !== undefined) lines.push(`错误码：${error.code}`)
  if (error.url) lines.push(`URL：${error.url}`)
  lines.push(`错误：${error.detail || error.message || String(error)}`)
  if (error.stack) lines.push('', error.stack)

  return lines.join('\n')
}

function getBriefByBiliCode (code) {
  const briefs = {
    '-101': 'B站接口提示未登录，请稍后重试或配置有效 Cookie。',
    '-352': 'B站 WBI 签名失效，插件会自动刷新后重试。',
    '-400': '请求参数异常，请检查 UID 是否正确。',
    '-404': '没有找到这个 UP 主或动态。',
    '-412': '触发 B站风控，请稍后再试；若持续失败请配置 B站 Cookie。',
    '412': '触发 B站风控，请稍后再试；若持续失败请配置 B站 Cookie。',
    '429': '请求过于频繁，请稍后再试。'
  }

  return briefs[String(code)] || 'B站接口返回异常，请稍后再试。'
}

async function getBiliHeaders (referer = 'https://www.bilibili.com/') {
  const config = loadConfig()
  const cookie = config.biliCookie || await getVisitorCookie(config)

  return {
    ...headers,
    referer,
    cookie
  }
}

async function getVisitorCookie (config = loadConfig()) {
  if (config.biliCookie) return ''

  const cached = config.visitorCookie || visitorCookieCache
  if (cached.value && Date.now() < cached.expireAt) {
    visitorCookieCache = cached
    return cached.value
  }

  const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers })
  if (!response.ok) return cached.value || ''

  const result = await response.json()
  const buvid3 = result.data?.b_3
  const buvid4 = result.data?.b_4
  if (!buvid3 && !buvid4) return cached.value || ''

  const value = [
    buvid3 ? `buvid3=${buvid3}` : '',
    buvid4 ? `buvid4=${buvid4}` : ''
  ].filter(Boolean).join('; ')

  visitorCookieCache = {
    value,
    expireAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  }

  config.visitorCookie = visitorCookieCache
  saveConfig(config)

  return value
}

function clearVisitorCookie () {
  visitorCookieCache = { value: '', expireAt: 0 }

  try {
    const config = loadConfig()
    config.visitorCookie = visitorCookieCache
    saveConfig(config)
  } catch {}
}

function normalizeCookie (cookie) {
  return String(cookie || '')
    .replace(/^cookie:\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

async function fetchLatestDynamic (uid) {
  const dynamics = await fetchDynamics(uid)
  return dynamics[0]
}

async function fetchDynamics (uid) {
  const query = await buildSignedDynamicQuery(uid)
  const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${query}`
  const requestHeaders = await getBiliHeaders(`https://space.bilibili.com/${uid}/dynamic`)
  const response = await fetch(url, {
    headers: requestHeaders
  })

  if (!response.ok) {
    if (response.status === 412) clearVisitorCookie()
    throw new BiliDynamicError(
      response.status === 412 ? getBriefByBiliCode(412) : 'B站接口请求失败，请稍后再试。',
      `B站动态接口 HTTP ${response.status}\nURL: ${url}`,
      { code: response.status, url }
    )
  }

  const result = await response.json()
  if (result.code !== 0) {
    if (result.code === -352) wbiKeyCache = { key: '', expireAt: 0 }
    throw new BiliDynamicError(
      getBriefByBiliCode(result.code),
      `B站动态接口返回 ${result.code}：${result.message || result.msg || '未知错误'}\nURL: ${url}`,
      { code: result.code, url }
    )
  }

  return (result.data?.items || [])
    .filter(item => !isPinned(item))
    .map(parseDynamic)
    .filter(Boolean)
}

async function buildSignedDynamicQuery (uid) {
  const params = {
    features:
      'itemOpusStyle,ClistOnlyfans,CopusBigCover,ConlyfansVote,CforwardListHidden,CdecorationCard,CcommentsNewVersion,ConlyfansAssetsV2,CugcDelete,ConlyfansQaCard,CavatarAutoTheme,CsunflowerStyle,CcardsEnhance,Ceva3CardOpus,Ceva3CardVideo,Ceva3CardComment,Ceva3CardUser',
    host_mid: uid,
    offset: '',
    platform: 'web',
    web_location: '0.0',
    timezone_offset: '-480',
    'x-bili-device-req-json': '{"platform":"web","device":"pc","spmid":"0.0"}'
  }

  return encodeWbi(params, await getWbiKey())
}

async function getWbiKey () {
  if (wbiKeyCache.key && Date.now() < wbiKeyCache.expireAt) return wbiKeyCache.key

  const requestHeaders = await getBiliHeaders('https://www.bilibili.com/')
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: requestHeaders })
  if (!response.ok) {
    throw new BiliDynamicError(
      'B站 WBI Key 获取失败，请稍后再试。',
      `获取 WBI Key HTTP ${response.status}`
    )
  }

  const result = await response.json()
  const imgUrl = result.data?.wbi_img?.img_url
  const subUrl = result.data?.wbi_img?.sub_url
  if (!imgUrl || !subUrl) {
    throw new BiliDynamicError(
      getBriefByBiliCode(result.code),
      `获取 WBI Key 失败：${result.message || result.msg || '未知错误'}`
    )
  }

  const imgKey = extractKey(imgUrl)
  const subKey = extractKey(subUrl)
  const mixinKey = mixinKeyEncTab.map(index => `${imgKey}${subKey}`[index]).join('')

  wbiKeyCache = {
    key: mixinKey,
    expireAt: Date.now() + 12 * 60 * 60 * 1000
  }

  return mixinKey
}

function encodeWbi (params, mixinKey) {
  const nextParams = {
    ...params,
    wts: Math.round(Date.now() / 1000)
  }

  const query = Object.keys(nextParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeValue(nextParams[key])}`)
    .join('&')

  const wRid = crypto
    .createHash('md5')
    .update(query + mixinKey)
    .digest('hex')

  return `${query}&w_rid=${wRid}`
}

function encodeValue (value) {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ''))
}

function extractKey (url) {
  return url.split('/').at(-1).split('.')[0]
}

function isPinned (item) {
  return item.modules?.module_tag?.text === '置顶'
}

function parseDynamic (item) {
  const id = item.id_str || item.id
  if (!id) return null

  const modules = item.modules || {}
  const author = modules.module_author || {}
  const dynamicModule = modules.module_dynamic || {}
  const major = dynamicModule.major || {}
  const descText = dynamicModule.desc?.text || ''
  const majorData = parseMajor(major)
  const dynamicType = item.type

  if (['DYNAMIC_TYPE_LIVE_RCMD', 'DYNAMIC_TYPE_LIVE', 'DYNAMIC_TYPE_NONE', 'DYNAMIC_TYPE_COMMON_SQUARE'].includes(dynamicType)) {
    return null
  }

  let title = majorData.title || firstLine(descText) || dynamicTypeName(dynamicType)
  let cover = majorData.cover

  if (dynamicType === 'DYNAMIC_TYPE_FORWARD') {
    const orig = item.orig ? parseDynamic(item.orig) : null
    title = firstLine(descText) || `转发：${orig?.title || '动态'}`
    cover = cover || orig?.cover
  }

  return {
    id: String(id),
    name: author.name || '',
    action: dynamicTypeName(dynamicType),
    title: cleanText(title, 80),
    cover,
    url: `https://www.bilibili.com/opus/${id}`,
    rawItem: item
  }
}

async function renderDynamicUiImage (dynamic) {
  try {
    const { renderDynamicCardForPush } = await import('../bili-card-plugin/lib/push.js')
    const result = await renderDynamicCardForPush(dynamic.id, { item: dynamic.rawItem })
    if (result?.image) return result.image
  } catch (error) {
    logger.warn(`[${pluginName}] 调用 bili-card-plugin 动态 UI 失败，回退原封面：${error?.message || error}`)
  }

  return dynamic.cover ? segment.image(dynamic.cover) : null
}

function parseMajor (major) {
  if (!major?.type) return {}

  switch (major.type) {
    case 'MAJOR_TYPE_OPUS': {
      const opus = major.opus || {}
      return {
        title: opus.title || opus.summary?.text,
        cover: getFirstPic(opus.pics)
      }
    }
    case 'MAJOR_TYPE_ARCHIVE':
      return {
        title: major.archive?.title,
        cover: major.archive?.cover
      }
    case 'MAJOR_TYPE_PGC':
      return {
        title: major.pgc?.title,
        cover: major.pgc?.cover
      }
    case 'MAJOR_TYPE_ARTICLE':
      return {
        title: major.article?.title,
        cover: getFirstPic(major.article?.covers) || major.article?.cover
      }
    case 'MAJOR_TYPE_DRAW':
      return {
        title: major.draw?.title,
        cover: getFirstPic(major.draw?.items)
      }
    case 'MAJOR_TYPE_COMMON':
      return {
        title: [major.common?.title, major.common?.desc].filter(Boolean).join(' '),
        cover: major.common?.cover
      }
    default:
      return {}
  }
}

function getFirstPic (pics) {
  if (!Array.isArray(pics) || !pics.length) return ''
  const first = pics[0]
  if (typeof first === 'string') return first
  return first.url || first.src || first.cover || ''
}

function firstLine (text) {
  return String(text || '').split('\n').map(line => line.trim()).find(Boolean) || ''
}

function cleanText (text, maxLength) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function dynamicTypeName (type) {
  const names = {
    DYNAMIC_TYPE_DRAW: '动态更新',
    DYNAMIC_TYPE_WORD: '动态更新',
    DYNAMIC_TYPE_FORWARD: '转发动态',
    DYNAMIC_TYPE_AV: '投稿视频',
    DYNAMIC_TYPE_ARTICLE: '投稿专栏',
    DYNAMIC_TYPE_PGC_UNION: '转发视频',
    DYNAMIC_TYPE_COMMON_SQUARE: '更换装扮'
  }

  return names[type] || '动态更新'
}

function compareDynamicId (left, right) {
  try {
    const leftId = BigInt(left)
    const rightId = BigInt(right)
    if (leftId > rightId) return 1
    if (leftId < rightId) return -1
    return 0
  } catch {
    return String(left).localeCompare(String(right))
  }
}
