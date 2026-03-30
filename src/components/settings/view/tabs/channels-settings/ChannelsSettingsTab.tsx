import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Plus, Trash2, Power, PowerOff, RefreshCw, Shield, Users } from 'lucide-react';
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

function ChannelsSettingsTab() {
  const { t } = useTranslation('settings');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [installUrl, setInstallUrl] = useState('');
  const [showInstallForm, setShowInstallForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [accessList, setAccessList] = useState<AccessEntry[]>([]);
  const [newSenderId, setNewSenderId] = useState('');

  // Fetch channels
  useEffect(() => {
    fetchChannels();
  }, []);

  // Fetch access list when channel is selected
  useEffect(() => {
    if (selectedChannel) {
      fetchAccessList(selectedChannel);
    }
  }, [selectedChannel]);

  const fetchChannels = async () => {
    try {
      const response = await authenticatedFetch('/api/channels');
      const data = await response.json();
      setChannels(data.channels || []);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
      console.error('Failed to fetch channels');
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

      console.log('Channel installed successfully');
      setInstallUrl('');
      setShowInstallForm(false);
      fetchChannels();
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

      console.log('Channel enabled');
      fetchChannels();
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

      console.log('Channel disabled');
      fetchChannels();
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

      console.log('Channel restarted');
      fetchChannels();
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

      console.log('Channel uninstalled');
      setSelectedChannel(null);
      fetchChannels();
    } catch (error) {
      console.error('Failed to uninstall channel');
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

      console.log('Sender added to allowlist');
      setNewSenderId('');
      fetchAccessList(selectedChannel);
    } catch (error) {
      console.error('Failed to add sender');
    }
  };

  const handleRemoveSender = async (senderId: string) => {
    if (!selectedChannel) return;

    try {
      const response = await authenticatedFetch(`/api/channels/${selectedChannel}/access/${encodeURIComponent(senderId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to remove sender');

      console.log('Sender removed from allowlist');
      fetchAccessList(selectedChannel);
    } catch (error) {
      console.error('Failed to remove sender');
    }
  };

  const getStatusIcon = (status: string, enabled: boolean) => {
    if (!enabled) return <PowerOff className="h-4 w-4 text-muted-foreground" />;
    if (status === 'running') return <Power className="h-4 w-4 text-green-500" />;
    if (status === 'error') return <PowerOff className="h-4 w-4 text-red-500" />;
    return <PowerOff className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Channels</h3>
          <p className="text-sm text-muted-foreground">
            Manage external messaging channels (iMessage, Discord, Telegram, etc.)
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

      {/* Install Form */}
      {showInstallForm && (
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <h4 className="mb-3 text-sm font-medium">Install New Channel</h4>
          <div className="flex gap-2">
            <input
              type="text"
              value={installUrl}
              onChange={(e) => setInstallUrl(e.target.value)}
              placeholder="GitHub URL (e.g., user/repo or https://github.com/user/repo)"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={handleInstall}>
              Install
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowInstallForm(false)}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Enter a GitHub repository URL containing a channel plugin
          </p>
        </div>
      )}

      {/* Channels List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12">
          <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No channels installed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Install a channel to connect external messaging platforms
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Channel List */}
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.name}
                onClick={() => setSelectedChannel(channel.name)}
                className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent/50 ${
                  selectedChannel === channel.name
                    ? 'border-primary bg-accent'
                    : 'border-border bg-background'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
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

                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                  {channel.description}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  {channel.enabled ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisable(channel.name);
                        }}
                        className="h-7 gap-1 text-xs"
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
                        className="h-7 gap-1 text-xs"
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
                      className="h-7 gap-1 text-xs"
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
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Uninstall
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Access Control Panel */}
          {selectedChannel && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-4 flex items-center gap-2 border-b border-border pb-4">
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
                    placeholder="Phone number or email"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {accessList.map((entry) => (
                      <div
                        key={entry.senderId}
                        className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
                      >
                        <span className="text-sm">{entry.senderId}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveSender(entry.senderId)}
                          className="h-6 w-6 p-0 text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ChannelsSettingsTab;
