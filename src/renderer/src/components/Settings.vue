<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { themePreference } from '../store/localStorageRead'

const theme = useTheme()

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
const downloadPath = ref(localStorage.getItem('instadrop_save_path') || defaultPathText)

const changeDownloadPath = async () => {
  // 调用 Electron API 打开文件夹选择器
  const path = await window.myElectronAPI?.selectFolder()
  
  if (path) {
    downloadPath.value = path
    localStorage.setItem('instadrop_save_path', path)
    triggerSnackbar('默认存储位置已更新', 'success')
  }
}

// 初始化时应用一次主题
onMounted(() => {
  applyTheme(themePreference.value)
})
</script>

<template>
  <v-container>
    <v-card max-width="800" class="mx-auto" variant="elevated" elevation="2">
      <v-list lines="two">
        <v-list-subheader class="text-primary font-weight-bold text-subtitle-1">
          常规设置
        </v-list-subheader>

        <v-list-item title="开机自启" subtitle="在系统启动时自动运行 Instadrop">
          <template v-slot:prepend><v-icon icon="mdi-rocket-launch" color="grey"></v-icon></template>
          <template v-slot:append><v-switch color="primary" hide-details density="compact"></v-switch></template>
        </v-list-item>

        <v-divider></v-divider>

        <v-list-item title="检查更新" subtitle="当前版本: v1.0.0 (已是最新版)">
          <template v-slot:prepend><v-icon icon="mdi-update" color="grey"></v-icon></template>
          <template v-slot:append>
            <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-restore">检查</v-btn>
          </template>
        </v-list-item>

        <v-divider></v-divider>

        <v-list-item title="默认存储路径" :subtitle="downloadPath">
          <template v-slot:prepend><v-icon icon="mdi-folder-download" color="grey"></v-icon></template>
          <template v-slot:append>
            <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-folder-edit" @click="changeDownloadPath">更改路径</v-btn>
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
                <v-text-field :rules="[rules.required]" v-model="tempTurnPass" label="凭证 (Credential)" variant="outlined" density="compact"
                  type="password"></v-text-field>
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