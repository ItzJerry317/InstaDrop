import { createApp } from 'vue'
import App from './App.vue'

// --- Vuetify 核心引入 ---
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css' // 引入 MDI 图标集

// 创建 Vuetify 实例
const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'dark' // 默认开启深色模式，更符合控制面板的审美
  }
})

// 挂载到 Vue 应用上
createApp(App).use(vuetify).mount('#app')