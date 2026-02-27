<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useTheme } from 'vuetify'
import { themePreference } from '../store/localStorageRead'
import { isElectron } from '../utils/platform'
import { marked } from 'marked'

const theme = useTheme()

// === 开机自启检测 ===
const autoStartEnabled = ref(false)
const toggleAutoStart = async () => {
  if (isElectron()) {
    try {
      await window.myElectronAPI?.setAutoStart(autoStartEnabled.value)
      triggerSnackbar(autoStartEnabled.value ? '已开启开机自启' : '已关闭开机自启', 'success')
    } catch (error) {
      console.error('设置开机自启失败:', error)
      triggerSnackbar('设置开机自启失败', 'error')
    }
  }
}

// === 检查更新状态 ===
const currentVersion = ref('v1.0.5') // 你的当前版本号
const isCheckingUpdate = ref(false)
const hasNewVersion = ref(false)
const showUpdateDialog = ref(false)
const latestVersionInfo = ref({ version: '', url: '', notes: '' })
const parsedReleaseNotes = computed(() => {
  if (!latestVersionInfo.value.notes) return ''
  return marked.parse(latestVersionInfo.value.notes, { breaks: true }) as string
})
const handleMarkdownClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  // 向上查找被点击的元素是否是 <a> 标签（使用 closest 可以兼容 <a> 内部嵌套了其他标签的情况）
  const aTag = target.closest('a')

  if (aTag && aTag.href) {
    e.preventDefault() // 阻止默认的当前页面跳转行为
    // 使用你们项目里已经验证过的跨平台外部打开方式
    window.open(aTag.href, '_blank')
  }
}

const checkForUpdates = async () => {
  if (isCheckingUpdate.value) return
  isCheckingUpdate.value = true

  try {
    const response = await fetch('https://api.github.com/repos/ItzJerry317/Instadrop/releases/latest')
    const data = await response.json()
    const latestVersion = data.tag_name

    // 假设这是从你的服务器拉取到的最新版本信息
    const mockApiResult = {
      version: latestVersion, // 试试把它改成 v1.0.0 测试“已是最新版”的提示
      url: 'https://github.com/ItzJerry317/Instadrop/releases', // 下载链接
      notes: data.body
    }

    // 对比版本号 (这里做了简单的字符串对比，实际开发可用 semver 库)
    if (mockApiResult.version !== currentVersion.value) {
      hasNewVersion.value = true
      latestVersionInfo.value = mockApiResult
      showUpdateDialog.value = true // 弹出更新提示框
    } else {
      hasNewVersion.value = false
      triggerSnackbar('当前已是最新版本，无需更新', 'success')
    }
  } catch (error) {
    console.error('检查更新失败:', error)
    triggerSnackbar('检查更新失败，请检查网络连接', 'error')
  } finally {
    isCheckingUpdate.value = false
  }
}

const openDownloadUrl = () => {
  // 跨平台通用的打开外部浏览器的方法
  window.open(latestVersionInfo.value.url, '_blank')
  showUpdateDialog.value = false
}

// 定义下拉框的选项
const themeOptions = [
  { label: '系统默认', value: 'system' },
  { label: '明亮', value: 'light' },
  { label: '暗黑', value: 'dark' }
]

// 探测系统当前真实主题的辅助器
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')

// 核心应用主题的方法
const applyTheme = (pref: string) => {
  if (pref === 'system') {
    theme.change(systemThemeMedia.matches ? 'dark' : 'light')
  } else {
    theme.change(pref)
  }
}

// === SnackBar控制 ===
const showSnackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('')

const triggerSnackbar = (message: string, color: string) => {
  snackbarMessage.value = message
  snackbarColor.value = color
  showSnackbar.value = true
}

// 监听下拉框的选择变化
watch(themePreference, (newTheme) => {
  localStorage.setItem('instadrop_theme', newTheme)
  applyTheme(newTheme)
})

systemThemeMedia.addEventListener('change', (e) => {
  if (themePreference.value === 'system') {
    theme.change(e.matches ? 'dark' : 'light')
  }
})

const rules = {
  required: (value: string) => !!value || '此项为必填项',
  stun: (value: string) => /^(stun|stuns):[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(value) || '这不是一个有效的 STUN 服务器地址'
}

// === 高级网络配置状态 ===
const showNetworkDialog = ref(false)

const signalingUrl = ref(localStorage.getItem('instadrop_signaling_url') || 'http://localhost:3000')
const stunUrl = ref(localStorage.getItem('instadrop_stun_url') || 'stun:stun.hitv.com:3478')
const turnUrl = ref(localStorage.getItem('instadrop_turn_url') || '')
const turnUser = ref(localStorage.getItem('instadrop_turn_user') || '')
const turnPass = ref(localStorage.getItem('instadrop_turn_pass') || '')

// 临时变量（用于在弹窗中编辑，不点保存不生效）
const tempSignalingUrl = ref('')
const tempStunUrl = ref('')
const tempTurnUrl = ref('')
const tempTurnUser = ref('')
const tempTurnPass = ref('')

const openNetworkDialog = () => {
  tempSignalingUrl.value = signalingUrl.value
  tempStunUrl.value = stunUrl.value
  tempTurnUrl.value = turnUrl.value
  tempTurnUser.value = turnUser.value
  tempTurnPass.value = turnPass.value
  showNetworkDialog.value = true
}

const saveNetworkSettings = () => {
  signalingUrl.value = tempSignalingUrl.value.trim()
  stunUrl.value = tempStunUrl.value.trim()
  turnUrl.value = tempTurnUrl.value.trim()
  turnUser.value = tempTurnUser.value.trim()
  turnPass.value = tempTurnPass.value.trim()

  localStorage.setItem('instadrop_signaling_url', signalingUrl.value)
  localStorage.setItem('instadrop_stun_url', stunUrl.value)
  localStorage.setItem('instadrop_turn_url', turnUrl.value)
  localStorage.setItem('instadrop_turn_user', turnUser.value)
  localStorage.setItem('instadrop_turn_pass', turnPass.value)

  showNetworkDialog.value = false
  triggerSnackbar('网络设置已保存！\n\n请在主界面断开并重新连接服务器，以使新配置生效。', 'success')
}

const resetNetworkSettings = () => {
  if (confirm('确定要恢复为默认的网络配置吗？')) {
    tempSignalingUrl.value = 'http://localhost:3000'
    tempStunUrl.value = 'stun:stun.hitv.com:3478'
    tempTurnUrl.value = ''
    tempTurnUser.value = ''
    tempTurnPass.value = ''
  }
}

// === 存储路径设置 ===
const defaultPathText = '默认 (下载/Instadrop)'
const getInitialPath = () => {
  const saved = localStorage.getItem('instadrop_save_path')
  if (!saved) return defaultPathText
  if (!isElectron() && saved !== defaultPathText) return `Documents/${saved}`
  return saved
}
const downloadPath = ref(getInitialPath())
const showMobilePathDialog = ref(false)
const tempMobilePath = ref('')

const changeDownloadPath = async () => {
  if (isElectron()) {
    // 调用 Electron API 打开文件夹选择器
    const path = await window.myElectronAPI?.selectFolder()

    if (path) {
      downloadPath.value = path
      localStorage.setItem('instadrop_save_path', path)
      triggerSnackbar('默认存储位置已更新', 'success')
    }
  } else {
    const current = localStorage.getItem('instadrop_save_path')
    tempMobilePath.value = (current && current !== defaultPathText) ? current : 'Instadrop'
    showMobilePathDialog.value = true
  }
}

const saveMobilePath = () => {
  // 过滤掉用户误输入的开头结尾斜杠，防止路径结构错乱
  let cleanPath = tempMobilePath.value.trim().replace(/^\/+|\/+$/g, '')
  if (!cleanPath) cleanPath = 'Instadrop' // 防呆保护：为空则恢复默认

  downloadPath.value = `Documents/${cleanPath}`
  localStorage.setItem('instadrop_save_path', cleanPath) // localStorage 里只存纯粹的子目录名

  showMobilePathDialog.value = false
  triggerSnackbar('默认存储位置已更新', 'success')
}

// 初始化时应用一次主题
onMounted(async () => {
  applyTheme(themePreference.value)
  if (isElectron()) {
    try {
      const status = await window.myElectronAPI?.getAutoStartStatus()
      if (status !== undefined) {
        autoStartEnabled.value = status
      }
    } catch (e) {
      console.error('无法读取开机自启状态:', e)
    }
  }
})
</script>

<template>
  <v-container>
    <v-card max-width="800" class="mx-auto" variant="elevated" elevation="2">
      <v-list lines="two">
        <v-list-subheader class="text-primary font-weight-bold text-subtitle-1">
          常规设置
        </v-list-subheader>

        <v-list-item title="开机自启" subtitle="在系统启动时自动运行 Instadrop" v-if="isElectron()">
          <template v-slot:prepend><v-icon icon="mdi-rocket-launch" color="grey"></v-icon></template>
          <template v-slot:append><v-switch color="primary" hide-details density="compact"
              @change="toggleAutoStart" v-model="autoStartEnabled"></v-switch></template>
        </v-list-item>

        <v-divider v-if="isElectron()"></v-divider>

        <v-list-item title="检查更新"
          :subtitle="hasNewVersion ? `发现新版本: ${latestVersionInfo.version}` : `当前版本: ${currentVersion}`">
          <template v-slot:prepend>
            <v-icon :icon="hasNewVersion ? 'mdi-alert-decagram' : 'mdi-update'"
              :color="hasNewVersion ? 'warning' : 'grey'"></v-icon>
          </template>
          <template v-slot:append>
            <v-btn variant="tonal" :color="hasNewVersion ? 'warning' : 'primary'" size="small"
              :prepend-icon="hasNewVersion ? 'mdi-download' : 'mdi-cloud-search-outline'" :loading="isCheckingUpdate"
              @click="hasNewVersion ? (showUpdateDialog = true) : checkForUpdates()">{{ hasNewVersion ? '查看更新' : '检查'
              }}</v-btn>
          </template>
        </v-list-item>

        <v-divider></v-divider>

        <v-list-item title="默认存储路径" :subtitle="downloadPath">
          <template v-slot:prepend><v-icon icon="mdi-folder-download" color="grey"></v-icon></template>
          <template v-slot:append>
            <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-folder-edit"
              @click="changeDownloadPath">更改路径</v-btn>
          </template>
        </v-list-item>

        <v-divider></v-divider>
        <v-list-item title="高级网络设置" subtitle="自定义信令服务器与公网穿透 (STUN/TURN) 服务器">
          <template v-slot:prepend><v-icon icon="mdi-network-outline" color="grey"></v-icon></template>
          <template v-slot:append>
            <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-cog" @click="openNetworkDialog">
              配置网络
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <v-divider></v-divider>

      <v-list>
        <v-list-subheader class="text-primary font-weight-bold text-subtitle-1">
          外观设置
        </v-list-subheader>
        <v-list-item title="选择模式" subtitle="跟随系统、明亮或暗黑模式">
          <template v-slot:prepend><v-icon icon="mdi-theme-light-dark" color="grey"></v-icon></template>
          <template v-slot:append>
            <v-select v-model="themePreference" :items="themeOptions" item-title="label" item-value="value" label="主题模式"
              variant="outlined" density="compact" hide-details></v-select>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <v-dialog v-model="showNetworkDialog" max-width="600" persistent>
      <v-card class="rounded-lg">
        <v-card-title class="text-h6 font-weight-bold text-primary px-5 pt-5 pb-3">
          <v-icon icon="mdi-server-network" class="mr-2"></v-icon>高级网络设置
        </v-card-title>
        <v-divider></v-divider>

        <v-card-text class="px-5 pt-5 text-body-2">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-5 text-caption" icon="mdi-alert-outline">
            修改以下配置可实现跨网段/公网传输。请勿使用不受信任的服务器节点。<br>如果您不了解这些设置的作用，请保持默认值。
          </v-alert>

          <div class="font-weight-bold mb-2">信令服务器</div>
          <v-text-field :rules="[rules.required]" v-model="tempSignalingUrl" label="WebSocket URL" variant="outlined"
            density="compact" placeholder="例如: http://你的IP:3000"></v-text-field>

          <div class="font-weight-bold mb-2 mt-2">STUN 服务器</div>
          <v-text-field :rules="[rules.stun]" v-model="tempStunUrl" label="STUN URL" variant="outlined"
            density="compact" placeholder="例如: stun:stun.hitv.com:3478"></v-text-field>

          <div class="font-weight-bold mb-2 mt-2">TURN 服务器 (非必填)</div>
          <v-text-field v-model="tempTurnUrl" label="TURN URL" variant="outlined" density="compact"
            placeholder="留空则仅使用直连 (例如: turn:你的IP:3478)"></v-text-field>

          <v-expand-transition>
            <v-row v-if="tempTurnUrl" class="mt-0">
              <v-col cols="6" class="py-0">
                <v-text-field :rules="[rules.required]" v-model="tempTurnUser" label="用户名 (Username)" variant="outlined"
                  density="compact"></v-text-field>
              </v-col>
              <v-col cols="6" class="py-0">
                <v-text-field :rules="[rules.required]" v-model="tempTurnPass" label="凭证 (Credential)"
                  variant="outlined" density="compact" type="password"></v-text-field>
              </v-col>
            </v-row>
          </v-expand-transition>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-btn color="error" variant="elevated" @click="resetNetworkSettings" prepend-icon="mdi-refresh">恢复默认</v-btn>
          <v-spacer></v-spacer>
          <v-btn color="grey-darken-1" variant="text" @click="showNetworkDialog = false">取消</v-btn>
          <v-btn color="primary" variant="elevated" @click="saveNetworkSettings">保存并应用</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showMobilePathDialog" max-width="400" persistent>
      <v-card class="rounded-lg">
        <v-card-title class="text-h6 font-weight-bold text-primary px-5 pt-5 pb-3">
          <v-icon icon="mdi-folder-edit-outline" class="mr-2"></v-icon>修改存储目录
        </v-card-title>
        <v-divider></v-divider>

        <v-card-text class="px-5 pt-5 pb-2">
          <div class="text-caption text-medium-emphasis mb-4">
            受限于安卓系统安全策略，文件将固定保存在公共存储的 <strong>Documents</strong> 目录下。您可以自定义专属的子文件夹名称：
          </div>
          <v-text-field v-model="tempMobilePath" label="子文件夹名称" variant="outlined" density="compact" autofocus
            @keyup.enter="saveMobilePath" prefix="Documents/"></v-text-field>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-btn text="恢复默认" color="error" variant="text" @click="tempMobilePath = 'Instadrop'"></v-btn>
          <v-spacer></v-spacer>
          <v-btn text="取消" @click="showMobilePathDialog = false" color="grey-darken-1"></v-btn>
          <v-btn variant="elevated" text="保存" color="primary" @click="saveMobilePath"></v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showUpdateDialog" max-width="450">
      <v-card class="rounded-lg">
        <v-card-title class="text-h6 font-weight-bold text-primary px-5 pt-5 pb-3">
          <v-icon icon="mdi-rocket-launch-outline" class="mr-2"></v-icon>发现新版本！
        </v-card-title>
        <v-divider></v-divider>

        <v-card-text class="px-5 pt-5 text-body-2">
          <div class="d-flex align-center mb-2">
            <span class="text-medium-emphasis mr-2">当前版本:</span>
            <v-chip size="small" variant="outlined">{{ currentVersion }}</v-chip>
            <v-icon icon="mdi-arrow-right" class="mx-3" size="small"></v-icon>
            <span class="text-medium-emphasis mr-2">最新版本:</span>
            <v-chip size="small" color="success" variant="flat">{{ latestVersionInfo.version }}</v-chip>
          </div>

          <div class="mt-6 font-weight-bold text-primary">
            <v-icon icon="mdi-clipboard-text-outline" size="small" class="mr-1"></v-icon>更新日志：
          </div>
          <div class="bg-surface-variant pa-4 rounded-lg mt-2 text-body-2 markdown-body" v-html="parsedReleaseNotes"
            @click="handleMarkdownClick"></div>
        </v-card-text>

        <v-card-actions class="pa-4 pt-2">
          <v-spacer></v-spacer>
          <v-btn color="grey-darken-1" variant="text" @click="showUpdateDialog = false">稍后再说</v-btn>
          <v-btn color="primary" variant="elevated" prepend-icon="mdi-open-in-new" @click="openDownloadUrl">前往下载</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="showSnackbar" :color="snackbarColor" timeout="3000" location="top">
      {{ snackbarMessage }}
      <template v-slot:actions>
        <v-btn variant="text" @click="showSnackbar = false">
          关闭
        </v-btn>
      </template>
    </v-snackbar>

  </v-container>
</template>
<style scoped>
/* 还原 Vuetify 抹除的 Markdown 默认排版样式 */
.markdown-body :deep(p) {
  margin-bottom: 8px;
  line-height: 1.6;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin-top: 12px;
  margin-bottom: 8px;
  font-weight: bold;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin-left: 24px;
  margin-bottom: 12px;
}

.markdown-body :deep(li) {
  margin-bottom: 4px;
}

.markdown-body :deep(blockquote) {
  border-left: 4px solid #aaa;
  padding-left: 12px;
  color: #888;
  margin: 12px 0;
  background-color: rgba(150, 150, 150, 0.1);
  padding: 8px 12px;
  border-radius: 0 4px 4px 0;
}

.markdown-body :deep(a) {
  color: #2196F3;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(strong) {
  font-weight: 900;
  color: inherit;
}
</style>