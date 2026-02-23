import { ref } from "vue";

export const themePreference = ref(localStorage.getItem('instadrop_theme') || 'system')
export const disclaimerAcceptedStatus = ref(localStorage.getItem('instadrop_disclaimer_accepted') || 'false')
export const signalingUrl = ref(localStorage.getItem('instadrop_signaling_url') || 'http://localhost:3000')
export const stunUrl = ref(localStorage.getItem('instadrop_stun_url') || 'stun:stun.hitv.com:3478')
export const turnUrl = ref(localStorage.getItem('instadrop_turn_url') || '未设置')
export const turnUser = ref(localStorage.getItem('instadrop_turn_user') || '未设置')
export const turnPass = ref(localStorage.getItem('instadrop_turn_pass') || '未设置')