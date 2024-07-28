import { Bot, Universal, Dict } from 'koishi'
import { MessageStats } from './index'

interface Info {
    path: string
    bot: Bot[]
    memory: number
    cpu: number
    background: string
    botStart: Dict<number>
    messages: Dict<MessageStats>
    nodeVersion: string
    v8Version: string
    uptime: number
    os: string
}

const statusMap: Record<Universal.Status, string[]> = {
    [Universal.Status.OFFLINE]: ['offline', '离线'],
    [Universal.Status.ONLINE]: ['online', '运行中'],
    [Universal.Status.CONNECT]: ['connect', '正在连接'],
    [Universal.Status.DISCONNECT]: ['disconnect', '正在断开'],
    [Universal.Status.RECONNECT]: ['reconnect', '正在重连']
}

function formatDuring(ms: number) {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.round((ms % (1000 * 60 * 60)) / (1000 * 60))
    return `${days}天${hours}小时${minutes}分`
}

// Forked from https://github.com/yeyang52/yenai-plugin/blob/098e0310392a25b036021f5523108ee2a8d57032/model/State/utils.js#L107
function circle(value: number) {
    const perimeter = 3.14 * 80
    const per = perimeter - perimeter * value
    let color = '--low-color'
    if (value >= 0.9) {
        color = '--high-color'
    } else if (value >= 0.8) {
        color = '--medium-color'
    }
    return {
        per,
        color: `var(${color})`,
        inner: Math.ceil(value * 100) + '%'
    }
}

// Forked from https://github.com/yeyang52/yenai-plugin/blob/098e0310392a25b036021f5523108ee2a8d57032/resources/state/index.html
export function generate(info: Info) {
    const now = Date.now()
    const botList = info.bot.map(v => {
        const runningTime = info.botStart[v.sid] ? now - info.botStart[v.sid] : info.uptime
        const receivedMessages = info.messages[v.sid]?.receive ?? 0
        const sentMessages = info.messages[v.sid]?.send ?? 0
        return `
            <div class="box">
            <div class="botInfo">
                <div class="avatar-box">
                    <div class="avatar">
                        <img src="${v.user.avatar}">
                    </div>
                    <div class="info">
                        <div class="onlineStatus">
                            <span class="status-light ${statusMap[v.status][0]}"></span>
                        </div>
                        <div class="status-text">${statusMap[v.status][1]}</div>
                    </div>
                </div>
                <div class="header">
                    <h1>${v.user.nick || v.user.name}</h1>
                    <hr noshade>
                    <p>
                        <span style="background: #d799de">
                            ${v.platform}
                        </span>
                        <span style="background: #CBC7C8">
                            已运行 ${formatDuring(runningTime)}
                        </span>
                    </p>
                    <p>
                        <span>
                            <img src="${info.path}/icon/sent.png">
                            昨日发送 ${sentMessages}
                        </span>
                        <span>
                            <img src="${info.path}/icon/recv.png">
                            昨日接收 ${receivedMessages}
                        </span>
                    </p>
                </div>
            </div>
        </div>`
    }).join('')
    const cpuCircle = circle(info.cpu)
    const memoryCircle = circle(info.memory)
    return `
        <!DOCTYPE html>
        <html lang="zh-cn">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>status</title>
            <link rel="stylesheet" href="${info.path}/css/common.css" />
            <link rel="stylesheet" href="${info.path}/css/index.css" />
            <style>
                .container {
                    background-image: url(${info.background});
                }
            </style>
        </head>
        <body class="elem-hydro default-mode">
            <div class="container" id="container">
                ${botList}
                <div class="box">
                    <ul class="mainHardware">
                        <li class="li">
                            <div class="container-box" data-num="${cpuCircle.inner}">
                                <div class="circle-outer"></div>
                                <svg>
                                    <circle id="circle" stroke="${cpuCircle.color}" style="stroke-dashoffset: ${cpuCircle.per}">
                                    </circle>
                                </svg>
                            </div>
                            <article>
                                <summary>CPU</summary>
                            </article>
                        </li>
                        <li class="li">
                            <div class="container-box" data-num="${memoryCircle.inner}">
                                <div class="circle-outer"></div>
                                <svg>
                                    <circle id="circle" stroke="${memoryCircle.color}" style="stroke-dashoffset: ${memoryCircle.per}">
                                    </circle>
                                </svg>
                            </div>
                            <article>
                                <summary>RAM</summary>
                            </article>
                        </li>
                    </ul>
                </div>
                <div class="box">
                    <div class="speed">
                        <p>系统</p>
                        <p>${info.os}</p>
                    </div>
                </div>
                <div class="copyright">Node <span class="version">v${info.nodeVersion}</span> & V8 <span class="version">v${info.v8Version}</span></div>
            </div>
        </body>
        </html>
    `
}