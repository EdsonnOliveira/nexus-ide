import {
  deletePushSubscription,
  getPushPreferences,
  upsertPushPreferences,
  upsertPushSubscription,
  type PushPreferencesRow,
} from '@nexus/supabase';
import { supabase } from '../lib/supabase';

const DEFAULT_PREFERENCES: Omit<PushPreferencesRow, 'user_id' | 'updated_at'> = {
  agent_enabled: true,
  deploy_enabled: true,
  device_enabled: true,
};

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const media = window.matchMedia('(display-mode: standalone)');
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return media.matches || nav.standalone === true;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export async function registerWebPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) {
    return null;
  }
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function getPushPermissionState(): Promise<NotificationPermission | 'unsupported'> {
  if (!isWebPushSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function loadPushPreferences(userId: string): Promise<{
  agent_enabled: boolean;
  deploy_enabled: boolean;
  device_enabled: boolean;
}> {
  const row = await getPushPreferences(supabase, userId);
  if (!row) {
    return { ...DEFAULT_PREFERENCES };
  }
  return {
    agent_enabled: row.agent_enabled,
    deploy_enabled: row.deploy_enabled,
    device_enabled: row.device_enabled,
  };
}

export async function savePushPreferences(
  userId: string,
  preferences: {
    agent_enabled: boolean;
    deploy_enabled: boolean;
    device_enabled: boolean;
  },
): Promise<void> {
  await upsertPushPreferences(supabase, {
    user_id: userId,
    agent_enabled: preferences.agent_enabled,
    deploy_enabled: preferences.deploy_enabled,
    device_enabled: preferences.device_enabled,
  });
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enableWebPush(userId: string): Promise<PushSubscription> {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error('VITE_VAPID_PUBLIC_KEY não configurada');
  }
  if (!isWebPushSupported()) {
    throw new Error('Este navegador não suporta notificações push');
  }
  if (isIosDevice() && !isStandaloneDisplay()) {
    throw new Error('No iPhone, adicione o Nexus à Tela de Início para receber push');
  }

  await registerWebPushServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permissão de notificação negada');
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Subscription inválida');
  }

  await upsertPushSubscription(supabase, {
    user_id: userId,
    endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
  });

  const preferences = await loadPushPreferences(userId);
  await savePushPreferences(userId, preferences);

  return subscription;
}

export async function disableWebPush(userId: string): Promise<void> {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    return;
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await deletePushSubscription(supabase, userId, endpoint);
}
