import { exec } from 'node:child_process'
import { version } from 'node:os'
import { platform } from 'node:process'

interface LinuxRelease {
    DISTRIB_ID?: string
    NAME?: string
    DISTRIB_RELEASE?: string
    VERSION_ID?: string
    DISTRIB_CODENAME?: string
    VERSION?: string
    VERSION_CODENAME?: string
    PRETTY_NAME?: string
}

interface OsData {
    platform: string
    distro: string
    release?: string
}

// Forked from https://github.com/sebhildebrandt/systeminformation/blob/6f93a934a0c767ab7647efa61995589f7dc0acdb/lib/osinfo.js#L206
export function osInfo(): Promise<OsData> {
    return new Promise((resolve) => {
        const result: OsData = {
            platform: platform === 'win32' ? 'Windows' : platform,
            distro: 'unknown'
        }
        if (platform === 'linux' || platform === 'android') {
            exec('cat /etc/*-release; cat /usr/lib/os-release; cat /etc/openwrt_release', function (error, stdout) {
                const release: LinuxRelease = {}
                const lines = stdout.toString().split('\n')
                lines.forEach(function (line) {
                    if (line.indexOf('=') !== -1) {
                        release[line.split('=')[0].trim().toUpperCase()] = line.split('=')[1].trim()
                    }
                })
                result.distro = (release.DISTRIB_ID || release.NAME || 'unknown').replace(/"/g, '')
                let releaseVersion = (release.VERSION || '').replace(/"/g, '')
                const prettyName = (release.PRETTY_NAME || '').replace(/"/g, '')
                if (prettyName.indexOf(result.distro + ' ') === 0) {
                    releaseVersion = prettyName.replace(result.distro + ' ', '').trim()
                }
                if (releaseVersion.indexOf('(') >= 0) {
                    releaseVersion = releaseVersion.split('(')[0].trim()
                }
                result.release = (releaseVersion || release.DISTRIB_RELEASE || release.VERSION_ID || 'unknown').replace(/"/g, '')
                resolve(result)
            })
        } else {
            result.distro = version()
            resolve(result)
        }
    })
}