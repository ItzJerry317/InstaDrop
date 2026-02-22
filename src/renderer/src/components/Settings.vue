<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { themePreference } from '../store/themeStore'

const theme = useTheme()

//定义下拉框的选项
const themeOptions = [
  { label: '系统默认', value: 'system' },
  { label: '明亮', value: 'light' },
  { label: '暗黑', value: 'dark' }
]

//探测系统当前真实主题的辅助器
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
console.log(`系统当前的深色模式状态: ${systemThemeMedia.matches ? 'dark' : 'light'}`)

//核心应用主题的方法
const applyTheme = (pref: string) => {
  if (pref === 'system') {
    // 如果是系统默认，则根据操作系统的深色模式状态来决定
    theme.change(systemThemeMedia.matches ? 'dark' : 'light')
  } else {
    // 否则强制使用用户选择的 light 或 dark
    theme.change(pref)
  }
}

//监听下拉框的选择变化
watch(themePreference, (newTheme) => {
  // 保存到本地存储
  localStorage.setItem('instadrop_theme', newTheme)
  console.log(`用户选择了主题: ${newTheme}`)
  console.log(localStorage.getItem('instadrop_theme'))
  // 立刻应用新主题
  applyTheme(newTheme)
})

//监听操作系统的深色模式切换事件
systemThemeMedia.addEventListener('change', (e) => {
  if (themePreference.value === 'system') {
    theme.change(e.matches ? 'dark' : 'light')
  }
})

// 初始化时应用一次主题
onMounted(() => {
  applyTheme(themePreference.value)
})
</script>

<template>
  <v-app>
    <v-main>
      <v-container>
        <v-card max-width="800" class="mx-auto" variant="elevated" elevation="2">

          <v-list lines="two">
            <v-list-subheader class="text-primary font-weight-bold text-subtitle-1">
              常规设置
            </v-list-subheader>

            <v-list-item title="开机自启" subtitle="在系统启动时自动运行 Instadrop">
              <template v-slot:prepend>
                <v-icon icon="mdi-rocket-launch" color="grey"></v-icon>
              </template>
              <template v-slot:append>
                <v-switch color="primary" hide-details density="compact"></v-switch>
              </template>
            </v-list-item>

            <v-divider></v-divider>

            <v-list-item title="检查更新" subtitle="当前版本: v1.0.0 (已是最新版)">
              <template v-slot:prepend>
                <v-icon icon="mdi-update" color="grey"></v-icon>
              </template>
              <template v-slot:append>
                <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-restore">
                  检查
                </v-btn>
              </template>
            </v-list-item>

            <v-divider></v-divider>

            <v-list-item title="默认存储路径" subtitle="C:\Users\Public\Downloads\Instadrop">
              <template v-slot:prepend>
                <v-icon icon="mdi-folder-download" color="grey"></v-icon>
              </template>
              <template v-slot:append>
                <v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-folder-edit">
                  更改路径
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
              <template v-slot:prepend>
                <v-icon icon="mdi-theme-light-dark" color="grey"></v-icon>
              </template>
              <template v-slot:append>
                <v-select
                  v-model="themePreference"
                  :items="themeOptions"
                  item-title="label"
                  item-value="value"
                  label="主题模式"
                  variant="outlined"
                  density="compact"
                  hide-details
                ></v-select>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>