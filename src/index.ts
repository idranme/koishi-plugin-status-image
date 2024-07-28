import { Context, Schema, Dict, Random, $, Time } from 'koishi'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { versions, uptime } from 'node:process'
import { cpus, freemem, totalmem, version } from 'node:os'
import { generate } from './template'
import type { } from 'koishi-plugin-puppeteer'
import type { } from '@koishijs/plugin-analytics'

export const name = 'status-image'
export const inject = ['puppeteer', 'database']

export interface Config {
    background: string[]
}

const path = pathToFileURL(join(__dirname, '../resource')).href

export const Config: Schema<Config> = Schema.object({
    background: Schema.array(String).role('table').description('背景图片地址，将会随机抽取其一')
        .default([`${path}/bg/default.webp`])
})

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

export interface MessageStats {
    send?: number
    receive?: number
}

export function apply(ctx: Context, cfg: Config) {
    const os = version()
    const botStart: Dict<number> = {}
    let usage = getCpuUsage()
    let cpuUsedRate = 0

    ctx.on('login-added', session => botStart[session.sid] = session.timestamp)
    ctx.on('ready', () => {
        ctx.setInterval(() => {
            const newUsage = getCpuUsage()
            cpuUsedRate = (newUsage.used - usage.used) / (newUsage.total - usage.total)
            usage = newUsage
        }, 5000)
    })

    async function getMessageCount() {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const yesterdayStart = new Date(today.getTime() - 1000 * 60 * 60 * 24)
        const data = await ctx.database
            .select('analytics.message', {
                date: {
                    $lt: Time.getDateNumber(),
                    $gte: Time.getDateNumber(yesterdayStart)
                },
            })
            .groupBy(['type', 'platform', 'selfId'], {
                count: row => $.sum(row.count),
            })
            .execute()
        const result: Dict<MessageStats> = {}
        for (const v of data) {
            result[`${v.platform}:${v.selfId}`] ??= {}
            result[`${v.platform}:${v.selfId}`][v.type] = v.count
        }
        return result
    }

    ctx.command('status-image', '查看运行状态')
        .action(async ({ session }) => {
            const messages = await getMessageCount()
            const background = Random.pick(cfg.background)
            const memory = 1 - freemem() / totalmem()
            const content = generate({
                bot: ctx.bots,
                path,
                nodeVersion: versions.node,
                v8Version: versions.v8,
                background,
                botStart,
                uptime: uptime() * 1000,
                memory,
                cpu: cpuUsedRate,
                os,
                messages
            })
            return await ctx.puppeteer.render(content)
        })
}