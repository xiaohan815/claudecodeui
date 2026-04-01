/**
 * Channels Settings Tab
 * 
 * 这是设置弹窗中的 Channels 配置页面（Settings → Channels）。
 * 用于管理所有已安装的 channels（feishu-channel, imessage-channel 等）。
 * 
 * 与 feishu-channel/index.js 的区别：
 * - 本文件（ChannelsSettingsTab.tsx）：设置弹窗，管理所有 channels 的通用配置界面
 * - feishu-channel/index.js：Feishu Channel 的主页面（Plugin Tab），专用配置界面
 * 
 * 两个文件都包含 PTY 配置，但本文件是通用的 channel 配置界面。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-react';
import { Button } from '../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../utils/api';

interface Channel {
  name: string;
  displayName: string;
  version: string;
  description: string;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  repoUrl: string | null;
}

interface AccessEntry {
  senderId: string;
  senderType: string;
  policy: string;
  createdAt: string;
}

interface ChannelConfigDraft {
  cwd: string;
  provider: string;
  model: string;
  appId: string;
  appSecretInput: string;
  domain: string;
  botName: string;
  allowedChatTypes: string[];
  hasAppSecret: boolean;
  usePersistentPty: boolean;
  ptyIdleTimeoutMinutes: number;
}

const DEFAULT_CONFIG: ChannelConfigDraft = {
  cwd: '',
  provider: 'claude',
  model: '',
  appId: '',
  appSecretInput: '',
  domain: 'feishu',
  botName: '',
  allowedChatTypes: ['p2p'],
  hasAppSecret: false,
  usePersistentPty: false,
  ptyIdleTimeoutMinutes: 30,
};

const FIELD_CLASS =
  'w-full rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70';

function ChannelsSettingsTab() {
  const { t } = useTranslation('settings');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [installUrl, setInstallUrl] = useState('');
  const [showInstallForm, setShowInstallForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [accessList, setAccessList] = useState<AccessEntry[]>([]);
  const [newSenderId, setNewSenderId] = useState('');
  const [configs, setConfigs] = useState<Record<string, ChannelConfigDraft>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configStatus, setConfigStatus] = useState<string | null>(null);

  const selectedChannelData = useMemo(
    () => channels.find((channel) => channel.name === selectedChannel) || null,
    [channels, selectedChannel],
  );
  const selectedConfig = selectedChannel ? configs[selectedChannel] : null;
  const isFeishuSelected = selectedChannel === 'feishu-channel';

  useEffect(() => {
    fetchChannels();
  }, []);

  useEffect(() => {
    if (!selectedChannel) {
      return;
    }
    fetchAccessList(selectedChannel);
    fetchChannelConfig(selectedChannel);
  }, [selectedChannel]);

  const fetchChannels = async () => {
    try {
      const response = await authenticatedFetch('/api/channels');
      const data = await response.json();
      const nextChannels = data.channels || [];
      setChannels(nextChannels);
      if (!selectedChannel && nextChannels.length > 0) {
        setSelectedChannel(nextChannels[0].name);
      }
      if (selectedChannel && !nextChannels.some((channel: Channel) => channel.name === selectedChannel)) {
        setSelectedChannel(nextChannels[0]?.name || null);
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAccessList = async (channelName: string) => {
    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}/access`);
      const data = await response.json();
      setAccessList(data.access || []);
    } catch (error) {
      console.error('Failed to fetch access list:', error);
    }
  };

  const fetchChannelConfig = async (channelName: string) => {
    setConfigLoading(true);
    setConfigStatus(null);
    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}/config`);
      const data = await response.json();
      const config = data.config || {};
      setConfigs((current) => ({
        ...current,
        [channelName]: {
          cwd: config.cwd || '',
          provider: config.provider || 'claude',
          model: config.model || '',
          appId: config.appId || '',
          appSecretInput: '',
          domain: config.domain || 'feishu',
          botName: config.botName || '',
          allowedChatTypes:
            Array.isArray(config.allowedChatTypes) && config.allowedChatTypes.length > 0
              ? config.allowedChatTypes
              : ['p2p'],
          hasAppSecret: Boolean(config.hasAppSecret),
          usePersistentPty: Boolean(config.usePersistentPty),
          ptyIdleTimeoutMinutes: config.ptyIdleTimeoutMinutes || 30,
        },
      }));
    } catch (error) {
      console.error('Failed to fetch channel config:', error);
    } finally {
      setConfigLoading(false);
    }
  };

  const updateSelectedConfig = (patch: Partial<ChannelConfigDraft>) => {
    if (!selectedChannel) {
      return;
    }
    setConfigs((current) => ({
      ...current,
      [selectedChannel]: {
        ...(current[selectedChannel] || DEFAULT_CONFIG),
        ...patch,
      },
    }));
  };

  const handleInstall = async () => {
    if (!installUrl.trim()) {
      console.error('Please enter a valid URL');
      return;
    }

    try {
      const response = await authenticatedFetch('/api/channels/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: installUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to install channel');
      }

      setInstallUrl('');
      setShowInstallForm(false);
      await fetchChannels();
    } catch (error: any) {
      console.error(error.message || 'Failed to install channel');
    }
  };

  const handleEnable = async (channelName: string) => {
    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}/enable`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to enable channel');
      await fetchChannels();
    } catch (error) {
      console.error('Failed to enable channel');
    }
  };

  const handleDisable = async (channelName: string) => {
    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}/disable`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to disable channel');
      await fetchChannels();
    } catch (error) {
      console.error('Failed to disable channel');
    }
  };

  const handleRestart = async (channelName: string) => {
    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}/restart`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to restart channel');
      await fetchChannels();
    } catch (error) {
      console.error('Failed to restart channel');
    }
  };

  const handleUninstall = async (channelName: string) => {
    if (!confirm(`Are you sure you want to uninstall "${channelName}"?`)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/channels/${channelName}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to uninstall channel');

      setConfigs((current) => {
        const next = { ...current };
        delete next[channelName];
        return next;
      });
      setSelectedChannel(null);
      await fetchChannels();
    } catch (error) {
      console.error('Failed to uninstall channel');
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedChannel || !selectedConfig) {
      return;
    }

    setConfigSaving(true);
    setConfigStatus(null);
    try {
      const payload: Record<string, unknown> = {
        cwd: selectedConfig.cwd.trim() || null,
        provider: selectedConfig.provider,
        model: selectedConfig.model.trim() || null,
        usePersistentPty: selectedConfig.usePersistentPty,
        ptyIdleTimeoutMinutes: selectedConfig.ptyIdleTimeoutMinutes,
      };

      if (isFeishuSelected) {
        payload.appId = selectedConfig.appId.trim();
        payload.domain = selectedConfig.domain;
        payload.botName = selectedConfig.botName.trim() || null;
        payload.allowedChatTypes = selectedConfig.allowedChatTypes;
        if (selectedConfig.appSecretInput.trim()) {
          payload.appSecret = selectedConfig.appSecretInput.trim();
        }
      }

      const response = await authenticatedFetch(`/api/channels/${selectedChannel}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save config');
      }

      const nextConfig = data.config || {};
      setConfigs((current) => ({
        ...current,
        [selectedChannel]: {
          cwd: nextConfig.cwd || '',
          provider: nextConfig.provider || 'claude',
          model: nextConfig.model || '',
          appId: nextConfig.appId || '',
          appSecretInput: '',
          domain: nextConfig.domain || 'feishu',
          botName: nextConfig.botName || '',
          allowedChatTypes:
            Array.isArray(nextConfig.allowedChatTypes) && nextConfig.allowedChatTypes.length > 0
              ? nextConfig.allowedChatTypes
              : ['p2p'],
          hasAppSecret: Boolean(nextConfig.hasAppSecret),
          usePersistentPty: Boolean(nextConfig.usePersistentPty),
          ptyIdleTimeoutMinutes: nextConfig.ptyIdleTimeoutMinutes || 30,
        },
      }));
      setConfigStatus(data.restarted ? 'Configuration saved and channel restarted.' : 'Configuration saved.');
      await fetchChannels();
    } catch (error: any) {
      console.error(error.message || 'Failed to save config');
      setConfigStatus(error.message || 'Failed to save config');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleAddSender = async () => {
    if (!selectedChannel || !newSenderId.trim()) {
      console.error('Please enter a sender ID');
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/channels/${selectedChannel}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: newSenderId.trim(),
          senderType: 'user',
          policy: 'allow',
        }),
      });

      if (!response.ok) throw new Error('Failed to add sender');

      setNewSenderId('');
      await fetchAccessList(selectedChannel);
    } catch (error) {
      console.error('Failed to add sender');
    }
  };

  const handleRemoveSender = async (senderId: string) => {
    if (!selectedChannel) {
      return;
    }

    try {
      const response = await authenticatedFetch(
        `/api/channels/${selectedChannel}/access/${encodeURIComponent(senderId)}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) throw new Error('Failed to remove sender');
      await fetchAccessList(selectedChannel);
    } catch (error) {
      console.error('Failed to remove sender');
    }
  };

  const getStatusIcon = (status: string, enabled: boolean) => {
    if (!enabled) return <PowerOff className="h-4 w-4 text-muted-foreground" />;
    if (status === 'running') return <Power className="h-4 w-4 text-emerald-500" />;
    if (status === 'error') return <PowerOff className="h-4 w-4 text-red-500" />;
    return <PowerOff className="h-4 w-4 text-muted-foreground" />;
  };

  const toggleAllowedChatType = (chatType: string) => {
    if (!selectedConfig) {
      return;
    }
    const nextValues = selectedConfig.allowedChatTypes.includes(chatType)
      ? selectedConfig.allowedChatTypes.filter((value) => value !== chatType)
      : [...selectedConfig.allowedChatTypes, chatType];
    updateSelectedConfig({
      allowedChatTypes: nextValues.length > 0 ? nextValues : ['p2p'],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Channels</h3>
          <p className="text-sm text-muted-foreground">
            Manage external messaging channels with isolated runtime and platform config.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowInstallForm(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Install Channel
        </Button>
      </div>

      {showInstallForm && (
        <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 shadow-sm">
          <h4 className="mb-3 text-sm font-medium">Install New Channel</h4>
          <div className="flex gap-2">
            <input
              type="text"
              value={installUrl}
              onChange={(e) => setInstallUrl(e.target.value)}
              placeholder="GitHub URL or local path"
              className={FIELD_CLASS}
            />
            <Button size="sm" onClick={handleInstall}>
              Install
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowInstallForm(false)}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Local installs now also resolve package dependencies automatically.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-12">
          <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No channels installed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Install a channel to connect external messaging platforms
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.name}
                onClick={() => setSelectedChannel(channel.name)}
                className={`cursor-pointer rounded-2xl border p-4 transition-all hover:border-primary/50 hover:bg-accent/40 ${
                  selectedChannel === channel.name
                    ? 'border-primary/70 bg-accent/70 shadow-sm'
                    : 'border-border/70 bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                      <MessageSquare className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground">
                        {channel.displayName || channel.name}
                      </h4>
                      <p className="text-xs text-muted-foreground">{channel.version}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(channel.status, channel.enabled)}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {channel.description}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {channel.enabled ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisable(channel.name);
                        }}
                        className="h-8 gap-1 text-xs"
                      >
                        <PowerOff className="h-3 w-3" />
                        Disable
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestart(channel.name);
                        }}
                        className="h-8 gap-1 text-xs"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Restart
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEnable(channel.name);
                      }}
                      className="h-8 gap-1 text-xs"
                    >
                      <Power className="h-3 w-3" />
                      Enable
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUninstall(channel.name);
                    }}
                    className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Uninstall
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {selectedChannel && selectedChannelData && (
            <div className="space-y-4">
              <div className="rounded-3xl border border-border/70 bg-background p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Channel Configuration
                    </p>
                    <h4 className="mt-2 text-xl font-semibold text-foreground">
                      {selectedChannelData.displayName || selectedChannelData.name}
                    </h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Runtime options stay isolated per channel. iMessage and Feishu can use
                      different working directories, providers, models, and platform credentials.
                    </p>
                  </div>
                  <div className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                    {selectedChannelData.status}
                  </div>
                </div>

                {configLoading || !selectedConfig ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="mt-6 space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Working Directory
                        </label>
                        <input
                          type="text"
                          value={selectedConfig.cwd}
                          onChange={(e) => updateSelectedConfig({ cwd: e.target.value })}
                          placeholder="/path/to/project"
                          className={FIELD_CLASS}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Provider
                        </label>
                        <select
                          value={selectedConfig.provider}
                          onChange={(e) => updateSelectedConfig({ provider: e.target.value })}
                          className={FIELD_CLASS}
                        >
                          <option value="claude">Claude</option>
                          <option value="cursor">Cursor</option>
                          <option value="codex">Codex</option>
                          <option value="gemini">Gemini</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Model
                        </label>
                        <input
                          type="text"
                          value={selectedConfig.model}
                          onChange={(e) => updateSelectedConfig({ model: e.target.value })}
                          placeholder="Optional model override"
                          className={FIELD_CLASS}
                        />
                      </div>
                    </div>

                    {isFeishuSelected && (
                      <div className="rounded-2xl border border-sky-500/15 bg-sky-500/5 p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-foreground">
                              Feishu / Lark Runtime
                            </h5>
                            <p className="mt-1 text-sm text-muted-foreground">
                              These values belong only to feishu-channel and do not affect other
                              channels.
                            </p>
                          </div>
                          <div className="rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground">
                            {selectedConfig.hasAppSecret ? 'App Secret stored' : 'App Secret missing'}
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              App ID
                            </label>
                            <input
                              type="text"
                              value={selectedConfig.appId}
                              onChange={(e) => updateSelectedConfig({ appId: e.target.value })}
                              placeholder="cli_xxx"
                              className={FIELD_CLASS}
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              App Secret
                            </label>
                            <input
                              type="password"
                              value={selectedConfig.appSecretInput}
                              onChange={(e) => updateSelectedConfig({ appSecretInput: e.target.value })}
                              placeholder={
                                selectedConfig.hasAppSecret
                                  ? 'Leave blank to keep current secret'
                                  : 'Enter app secret'
                              }
                              className={FIELD_CLASS}
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              Domain
                            </label>
                            <select
                              value={selectedConfig.domain}
                              onChange={(e) => updateSelectedConfig({ domain: e.target.value })}
                              className={FIELD_CLASS}
                            >
                              <option value="feishu">Feishu (China)</option>
                              <option value="lark">Lark (Global)</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              Bot Name
                            </label>
                            <input
                              type="text"
                              value={selectedConfig.botName}
                              onChange={(e) => updateSelectedConfig({ botName: e.target.value })}
                              placeholder="Optional display name"
                              className={FIELD_CLASS}
                            />
                          </div>
                        </div>

                        <div className="mt-4">
                          <p className="mb-3 text-sm font-medium text-foreground">
                            Allowed Chat Types
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {['p2p', 'group'].map((chatType) => (
                              <label
                                key={chatType}
                                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-2 text-sm text-foreground"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedConfig.allowedChatTypes.includes(chatType)}
                                  onChange={() => toggleAllowedChatType(chatType)}
                                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                />
                                {chatType === 'p2p' ? 'Direct Messages' : 'Group Mentions'}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedConfig.provider === 'claude' && (
                      <div className="rounded-2xl border border-purple-500/15 bg-purple-500/5 p-4">
                        <div className="mb-4">
                          <h5 className="text-sm font-semibold text-foreground">
                            Advanced Settings
                          </h5>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Performance optimization for Claude provider
                          </p>
                        </div>

                        <div className="space-y-4">
                          <label className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={selectedConfig.usePersistentPty}
                              onChange={(e) => updateSelectedConfig({ usePersistentPty: e.target.checked })}
                              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-foreground">
                                Persistent PTY Mode
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                Maintain a background Claude process for each conversation to reduce startup overhead. 
                                Session history stays in memory instead of being reloaded from disk on every message.
                              </p>
                            </div>
                          </label>

                          {selectedConfig.usePersistentPty && (
                            <div className="ml-7 mt-3">
                              <label className="mb-2 block text-sm font-medium text-foreground">
                                Idle Timeout (minutes)
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="120"
                                value={selectedConfig.ptyIdleTimeoutMinutes}
                                onChange={(e) => updateSelectedConfig({ 
                                  ptyIdleTimeoutMinutes: Math.max(1, Math.min(120, parseInt(e.target.value) || 30))
                                })}
                                className={FIELD_CLASS + ' w-32'}
                              />
                              <p className="mt-2 text-xs text-muted-foreground">
                                Background processes will be terminated after this period of inactivity
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        {configStatus || 'Save changes to persist this channel configuration.'}
                      </p>
                      <Button onClick={handleSaveConfig} disabled={configSaving} className="gap-2">
                        {configSaving && <RefreshCw className="h-4 w-4 animate-spin" />}
                        Save Configuration
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-border/70 bg-background p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 border-b border-border/70 pb-4">
                  <Shield className="h-5 w-5 text-primary" />
                  <h4 className="font-medium">Access Control</h4>
                </div>

                <div className="mb-4">
                  <p className="mb-2 text-sm text-muted-foreground">
                    Add sender IDs to the allowlist
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSenderId}
                      onChange={(e) => setNewSenderId(e.target.value)}
                      placeholder="Phone number, email, or open_id"
                      className={FIELD_CLASS}
                    />
                    <Button size="sm" onClick={handleAddSender}>
                      Add
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" />
                    Allowed Senders ({accessList.length})
                  </h5>
                  {accessList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No senders in allowlist</p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {accessList.map((entry) => (
                        <div
                          key={entry.senderId}
                          className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/30 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm text-foreground">{entry.senderId}</p>
                            <p className="text-xs text-muted-foreground">{entry.policy}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveSender(entry.senderId)}
                            className="h-8 w-8 p-0 text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ChannelsSettingsTab;
