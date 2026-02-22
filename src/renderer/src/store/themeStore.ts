import { ref } from "vue";

export const themePreference = ref(localStorage.getItem('instadrop_theme') || 'system')