import { createApp } from 'vue'
import App from './App.vue'

import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css'
import colors from 'vuetify/util/colors'

// 创建 Vuetify 实例
const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'system',
    themes: {
      dark: {
        dark: true,
        colors: {
          primary: colors.indigo.accent2,
          secondary: colors.indigo.lighten2,

          // 你也可以同时重写其他状态色
          info: colors.teal.base,
          success: colors.green.accent3,
          warning: colors.orange.darken1,
          error: colors.red.accent2,

          // 甚至可以自定义背景色和面板颜色
          // background: '#121212',
          // surface: '#1E1E1E',
        }
      }
    }
  }
})

// 挂载到 Vue 应用上
createApp(App).use(vuetify).mount('#app')