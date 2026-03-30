# Feishu Channel

This channel connects a Feishu or Lark bot to claudecodeui by using Feishu long connection mode.

## Current scope

- text message receive + reply
- image message receive + forward to Claude-compatible channel message input
- group handling when the bot is mentioned and group chat is enabled
- per-channel runtime isolation through the host configuration page

## Required Feishu app setup

1. Create a self-built app in Feishu Open Platform or Lark Open Platform.
2. Enable bot capability.
3. Add the `im.message.receive_v1` event subscription in long connection mode.
4. Grant message and resource permissions required for bot receive/send and image resource access.
5. Publish the app before testing with real conversations.

## Host configuration

Open **Settings → Channels**, select **Feishu Channel**, and configure:

- App ID
- App Secret
- Domain (`feishu` or `lark`)
- Bot Name
- Allowed Chat Types
- Working Directory
- Provider
- Model

`App Secret` is write-only in the UI. Leaving it blank during save keeps the stored secret.

## Notes

- `cwd`, `provider`, and `model` remain isolated by `channel_name`, so Feishu and iMessage can point to different workspaces.
- Image forwarding is passed directly to Claude through the host channel message API.
- Non-image message types are ignored in this first version.
