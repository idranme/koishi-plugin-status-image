import { Context, Schema, Dict, $, Time, Universal, Random } from 'koishi'
import { versions, uptime } from 'node:process'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { osInfo } from './osinfo'
import { MessageStats, BotInfo, SystemInfo } from './types'
import { generateAeroTheme } from './template/aero'
import { generateYenaiTheme } from './template/yenai'
import type { } from '@koishijs/plugin-analytics'
import type { } from 'koishi-plugin-puppeteer'

// Re-export types for external use
export { MessageStats, BotInfo, SystemInfo } from './types'

export const name = 'status-image'
export const inject = ['database', 'puppeteer']

export interface Config {
  background: string[]
  theme: 'yenai-light' | 'yenai-dark' | 'aero-light' | 'aero-dark'
  backgroundMaskOpacity?: number
  displayName: {
    sid: string
    name: string
  }[]
}

const path = pathToFileURL(join(__dirname, '../resource')).href

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    background: Schema.array(String).role('table').description('背景图片地址，将会随机抽取其一')
      .default([`${path}/bg/default.webp`, `${path}/bg/TohsakaRin.webp`]),
    displayName: Schema.array(Schema.object({
      sid: Schema.string().description('机器人平台名与自身 ID, 例如 `onebot:123456`').required(),
      name: Schema.string().description('显示名称').required()
    })).description('自定义机器人显示名称').default([]),
    theme: Schema.union(['yenai-light', 'yenai-dark', 'aero-light', 'aero-dark']).description('主题').required()
  }),
  Schema.union([
    Schema.object({
      theme: Schema.const('yenai-light').required(),
      backgroundMaskOpacity: Schema.natural().max(1).step(0.01).description('背景遮罩不透明度').default(0.15),
    }),
    Schema.object({
      theme: Schema.const('yenai-dark').required(),
      backgroundMaskOpacity: Schema.natural().max(1).step(0.01).description('背景遮罩不透明度').default(0.15),
    }),
    Schema.object({
      theme: Schema.const('aero-light').required(),
    }),
    Schema.object({
      theme: Schema.const('aero-dark').required(),
    })
  ])
])

// Forked from https://github.com/koishijs/webui/blob/14ec1b6164cec194b1725f7cd076622e76cb946f/plugins/status/src/profile.ts#L52
function getCpuUsage() {
  let totalIdle = 0, totalTick = 0
  const cpuInfo = cpus()

  for (const cpu of cpuInfo) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type]
    }
    totalIdle += cpu.times.idle
  }

  return {
    used: totalTick - totalIdle,
    total: totalTick
  }
}

export function apply(ctx: Context, cfg: Config) {
  const botStart: Dict<number> = {}
  let usage: ReturnType<typeof getCpuUsage>
  let cpuUsedRate = 0
  let cachedMessageCount: Dict<MessageStats>
  let cachedDate: number
  let os: string

  ctx.on('login-added', session => botStart[session.sid] = session.timestamp)

  ctx.on('ready', async () => {
    usage = getCpuUsage()
    ctx.setInterval(() => {
      const newUsage = getCpuUsage()
      cpuUsedRate = (newUsage.used - usage.used) / (newUsage.total - usage.total)
      usage = newUsage
    }, 5000)
    const dateNumber = Time.getDateNumber()
    cachedMessageCount = await getMessageCount(dateNumber)
    cachedDate = dateNumber
    const { distro, release } = await osInfo()
    os = release ? `${distro} ${release}` : distro
  })

  async function getMessageCount(dateNumber: number) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterdayStart = new Date(today.getTime() - 1000 * 60 * 60 * 24)
    const data = await ctx.database
      .select('analytics.message', {
        date: {
          $lt: dateNumber,
          $gte: Time.getDateNumber(yesterdayStart)
        }
      })
      .groupBy(['type', 'platform', 'selfId'], {
        count: row => $.sum(row.count)
      })
      .execute()
    const result: Dict<MessageStats> = {}
    for (const v of data) {
      result[`${v.platform}:${v.selfId}`] ??= {}
      result[`${v.platform}:${v.selfId}`][v.type] = v.count
    }
    return result
  }

  async function getSystemInfo(platform?: string): Promise<SystemInfo> {
    const dateNumber = Time.getDateNumber()
    if (dateNumber !== cachedDate) {
      cachedMessageCount = await getMessageCount(dateNumber)
      cachedDate = dateNumber
    }

    const now = Date.now()
    const bots: BotInfo[] = []

    for (const bot of ctx.bots) {
      if (bot.platform.startsWith('sandbox:') && platform && !platform.startsWith('sandbox:')) {
        continue
      }
      if (bot.hidden) {
        continue
      }

      const runningTime = botStart[bot.sid] ? now - botStart[bot.sid] : uptime() * 1000
      const messages = cachedMessageCount[bot.sid] || { send: 0, receive: 0 }

      let name = bot.user.nick || bot.user.name || ''
      const customize = cfg.displayName.find(e => e.sid === bot.sid)
      if (customize) {
        name = customize.name
      }

      bots.push({
        sid: bot.sid,
        platform: bot.platform,
        status: bot.status,
        name,
        avatar: bot.user.avatar,
        runningTime,
        messages: {
          send: messages.send || 0,
          receive: messages.receive || 0
        }
      })
    }

    const totalMemory = totalmem()
    const freeMemory = freemem()
    const usedMemory = totalMemory - freeMemory
    const memoryPercentage = usedMemory / totalMemory

    // Try to read swap info from /proc/meminfo (Linux only)
    let swapTotal = 0
    let swapFree = 0
    try {
      const meminfo = await readFile('/proc/meminfo', 'utf8')
      for (const line of meminfo.split('\n')) {
        if (line.startsWith('SwapTotal:')) {
          const kb = parseInt(line.replace(/[^0-9]/g, '')) || 0
          swapTotal = kb * 1024
        } else if (line.startsWith('SwapFree:')) {
          const kb = parseInt(line.replace(/[^0-9]/g, '')) || 0
          swapFree = kb * 1024
        }
      }
    } catch { }
    const swapUsed = swapTotal > 0 ? Math.max(0, swapTotal - swapFree) : 0
    const swapPercentage = swapTotal > 0 ? swapUsed / swapTotal : 0

    return {
      bots,
      system: {
        os,
        nodeVersion: versions.node,
        v8Version: versions.v8,
        uptime: uptime() * 1000,
        memory: {
          used: usedMemory,
          total: totalMemory,
          percentage: memoryPercentage
        },
        swap: swapTotal > 0 ? {
          used: swapUsed,
          total: swapTotal,
          percentage: swapPercentage,
        } : {
          used: 0,
          total: 0,
          percentage: 0,
        },
        cpu: {
          usage: cpuUsedRate
        }
      }
    }
  }

  // 暴露 getSystemInfo 函数供外部使用
  ctx.provide('status-image.getSystemInfo', getSystemInfo)

  ctx.command('status-image', '查看运行状态')
    .action(async ({ session }) => {
      const systemInfo = await getSystemInfo(session.platform)

      // 随机选择背景图片
      const background = Random.pick(cfg.background)

      // 生成 HTML 内容
      let content: string
      // 稍微优化一下
      switch(cfg.theme) {
        case 'aero-dark':
        case 'aero-light':
          content = generateAeroTheme({
            path,
            background,
            systemInfo,
            activeSid: session.sid,
            activePlatform: session.platform,
            displayName: cfg.displayName,
            darkMode: cfg.theme.includes('dark')
          });
          break;
        case 'yenai-light':
        case 'yenai-dark':
          content = generateYenaiTheme({
            path,
            background,
            systemInfo,
            maskOpacity: cfg.backgroundMaskOpacity,
            displayName: cfg.displayName,
            darkMode: cfg.theme.includes('dark')
          });
      }
      // 原代码
      // if (cfg.theme === 'aero-dark') {
      //   content = generateAeroTheme({
      //     path,
      //     background,
      //     systemInfo,
      //     activeSid: session.sid,
      //     activePlatform: session.platform,
      //     displayName: cfg.displayName,
      //     darkMode: true
      //   })
      // } else if (cfg.theme === 'aero-light') {
      //   content = generateAeroTheme({
      //     path,
      //     background,
      //     systemInfo,
      //     activeSid: session.sid,
      //     activePlatform: session.platform,
      //     displayName: cfg.displayName,
      //     darkMode: false
      //   })
      // } else if (['yenai-light', 'yenai-dark'].includes(cfg.theme)) {
      //   content = generateYenaiTheme({
      //     path,
      //     background,
      //     systemInfo,
      //     maskOpacity: cfg.backgroundMaskOpacity,
      //     displayName: cfg.displayName,
      //     darkMode: cfg.theme === 'yenai-dark'
      //   })
      // }

      // 使用 puppeteer 渲染图片
      return await ctx.puppeteer.render(content)
    })
}
