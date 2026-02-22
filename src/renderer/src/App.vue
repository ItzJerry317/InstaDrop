<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Home from './components/Home.vue'
import TestPanel from './components/TestPanel.vue'
import Settings from './components/Settings.vue'
import { useTheme } from 'vuetify'
import { themePreference } from './store/themeStore'

const currentTab = ref('home')
const drawer = ref(false)
const windowStatus = ref('mdi-window-maximize')

// 窗口状态
const checkWindowStatus = async () => {
  windowStatus.value = await window.myElectronAPI.getWindowStatus()
  console.log(`当前窗口状态: ${windowStatus.value}`)
}

const closeApp = () => {
  window.myElectronAPI.closeWindow()
}

const toggleWindowStatus = () => {
  window.myElectronAPI.toggleWindowStatus()
  checkWindowStatus()
}
const minimizeApp = () => {
  window.myElectronAPI.minimizeWindow()
}

const theme = useTheme()
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (pref: string) => {
  if (pref === 'system') {
    // 如果是系统默认，则根据操作系统的深色模式状态来决定
    theme.change(systemThemeMedia.matches ? 'dark' : 'light')
  } else {
    // 否则强制使用用户选择的 light 或 dark
    theme.change(pref)
  }
}

onMounted(() => {
  applyTheme(themePreference.value)
  checkWindowStatus()
  window.myElectronAPI.onWindowStateChanged((newState) => {
    console.log(`窗口状态变化: ${newState}`)
    windowStatus.value = newState === 'maximized' ? 'mdi-window-restore' : 'mdi-window-maximize'
  })
})
</script>

<template>
  <v-app>
    
    <v-app-bar color="primary" density="compact" style="-webkit-app-region: drag;">
      <v-btn icon="mdi-menu" style="-webkit-app-region: no-drag;" @click="drawer = !drawer"></v-btn>
      <v-app-bar-title>Instadrop</v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-window-minimize" style="-webkit-app-region: no-drag;" @click="minimizeApp"></v-btn>
      <v-btn :icon="windowStatus" style="-webkit-app-region: no-drag;" @click="toggleWindowStatus"></v-btn>
      <v-btn icon="mdi-close" style="-webkit-app-region: no-drag;" @click="closeApp"></v-btn>
    </v-app-bar>

    <v-navigation-drawer  v-model="drawer" temporary>
      <v-list density="compact" nav>
        <v-list-item
          prepend-icon="mdi-home"
          title="主页"
          value="home"
          :active="currentTab === 'home'"
          @click="currentTab = 'home'"
          color="primary"
        ></v-list-item>
        
        <v-list-item
          prepend-icon="mdi-test-tube"
          title="测试"
          value="test"
          :active="currentTab === 'test'"
          @click="currentTab = 'test'"
          color="primary"
        ></v-list-item>

        <v-list-item
          prepend-icon="mdi-cog"
          title="设置"
          value="settings"
          :active="currentTab === 'settings'"
          @click="currentTab = 'settings'"
          color="primary">
        </v-list-item>
      </v-list>
    </v-navigation-drawer>
    
    <v-main>
      <Home v-if="currentTab === 'home'" />
      <TestPanel v-if="currentTab === 'test'" />
      <Settings v-if="currentTab === 'settings'" />
    </v-main>
  </v-app>
</template>

<style scoped>
</style>

<style>
html {
  overflow: hidden !important;
}
.v-main {
  height: 100vh;
  overflow-y: auto;
}
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
</style>