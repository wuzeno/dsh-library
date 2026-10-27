# DSH Library · Bring your project files into the conversation

[简体中文](README.md) | **English**

Give every project in **DeepSeek Harness** its own library. Keep documents, images, spreadsheets, and other project files together, then turn on library mode in a conversation so AI can refer to the original files as needed.

Files stay in a local directory you choose, organized by workspace. Manage all your libraries from the Library menu, and choose which ones to use in each conversation.

[Download](https://github.com/wuzeno/dsh-library/releases/latest) · [Installation](#installation) · [Getting started](#getting-started) · [Report an issue](https://github.com/wuzeno/dsh-library/issues)

![Library management page](docs/images/library-panel.jpg)

> The screenshots use a custom theme. The background and desktop decorations come from the theme; this plugin provides the library features. The management interface is currently in Chinese.

## Features

### Keep each project's files together

New workspaces get their own libraries automatically. For existing workspaces, create a library or link one you already have. The management page lets you find libraries by name, workspace, or storage path, and sort them by last updated, name, or file count.

### Choose where your files live

On first use, choose a local folder for library storage. Importing copies files into the library and leaves the originals in their source folder. Each library has its own directory, making storage and backups easier to organize.

### Import files and folders in batches

Store original files in any format. Select or drag in multiple files or entire folders, review the list in a dialog, and confirm the import. Follow progress and individual file results as they come in. Files with the same name are stored separately.

### Bring relevant files into the conversation

In library mode, AI can find authorized files and open the relevant originals, using the current model and available file tools to answer your questions. Conversations use the library linked to the current workspace by default. You can authorize additional libraries for that conversation, or switch back to general mode for everyday chat.

### Decide which files AI can use

Include or exclude individual files from AI reference, download originals, or move files to the recovery area and restore them later. For larger cleanups, move a library's files to the recovery area in one action, empty the recovery area, or deactivate and delete a library. Permanent deletion requires you to type the name to confirm.

## Installation

The current stable release is **1.0.0**, targeting the DeepSeek Harness `0.2.1-rc.3` interface. The declared compatibility range is `>=0.2.1-rc.3 <0.3.0`, with Node.js ≥22.13.0 required. See the [validation notes](docs/validation.md) for host-version testing details.

1. Download the **`dsh-library-1.0.0.tgz`** plugin package from [Releases](https://github.com/wuzeno/dsh-library/releases/latest).
2. Open the DSH plugin manager, install the local package, and enable it. If your host offers a local-directory linking option instead, extract the package and select the `package` folder containing `package.json`.
3. Fully quit DSH, including its background process in the system tray. Start it again and refresh the page. Look for **资料库** (Library) in the sidebar.

When upgrading, keep your existing files. Back up both the library storage directory and your DSH profile, install the new version, and fully restart DSH.

## Getting started

1. **Choose a storage location.** Open **资料库 → 存储与隐私** (Library → Storage & Privacy), select or enter an absolute local path on the computer running DSH, and save it.
2. **Confirm file access.** On the same page, choose whether to allow the model to use complete original files on demand.
3. **Add your project files.** New workspaces get libraries automatically. For an existing workspace, create or link a library, drag in files or folders, review the list, and confirm.
4. **Ask a question.** Turn on library mode in the conversation, check which libraries are in scope, and describe what you need.

For example: “What reference documents are in this project?” or “Use the requirements document in the library to summarize the features we need to build.”

<details>
<summary>See the menu and conversation settings</summary>

### Menu entry
![Library menu](docs/images/menu-entry.jpg)

### Choose whether to use library files in a conversation
![Library controls in the conversation](docs/images/conversation-entry.jpg)

### Set access for the current conversation
![Conversation library scope](docs/images/session-scope.jpg)

</details>

## On-demand attachments and privacy

Files are stored locally first. When needed, the model opens relevant originals within the scope you authorize. You can manage files as soon as they are imported; reading their contents depends on the host, current model, and available tools. A format that can be stored may not be readable by your current setup.

When using a cloud model, opening a file may send the complete original to the model and retain it in conversation attachments and history. Turning off access stops future delivery; content already sent remains in the original conversation. Consider the sensitivity of your files before granting access, and keep your library storage directory outside Git repositories.

For details on authorization, attachment delivery, and data handling, see the [technical reference](docs/usage-reference.md#按需附件与隐私) and [security notes](SECURITY.md).

## File formats and limits

Store original files in any format and import folders recursively. The default per-file limit is **50 MiB**, configurable from **1–200 MiB**. Each library holds up to **2,000 files**, including those in the recovery area.

See the [full limits and behavior](docs/usage-reference.md#格式与边界) for batch imports, folder scanning, and file handling.

## Move all files to the recovery area

In a library's **文件** (Files) tab, click **全部移入回收区** (Move all to recovery area) and enter the full library name to confirm. This moves all files that are not already in the recovery area, including excluded files. It applies to the whole library, regardless of the current search or filter. You can restore files individually afterward.

## Permanently delete files from the recovery area

In **回收区** (Recovery area), permanently delete individual files or empty the entire recovery area. Both actions require the full name to confirm and delete the library's copies to free the corresponding disk space. Permanent deletion cannot be undone, so back up important files first.

## Delete a library

Deactivate the library, then choose **删除资料库** (Delete library) on its detail page. The confirmation dialog shows the file count and local directory. Enter the full library name to delete the library and the files in its directory. Originals in the source folder stay untouched.

See the [operation details](docs/usage-reference.md#删除资料库) for error handling and retries.

## Storage and backups

Back up **both the library storage directory and your DSH profile** to preserve original files along with library links, permissions, and other settings. After you change the storage root, new libraries use the new location; existing libraries stay where they are.

See the [backup reference](docs/usage-reference.md#数据布局与备份) and [architecture and recovery notes](docs/architecture.md) for directory structure, metadata, and recovery details.

## Development and releases

Development requires Node.js 22.13+ (24 LTS recommended) and pnpm.

```sh
pnpm install --ignore-scripts
pnpm run test:all
pnpm pack --pack-destination release
```

See the [contributing guide](CONTRIBUTING.md), [release checklist](docs/releasing.md), and [validation notes](docs/validation.md). Implementation details are in the [technical reference](docs/usage-reference.md#开发与发布).

The linked supporting documents are currently in Chinese.

## License

This is an unofficial plugin for DeepSeek Harness and is not affiliated with DeepSeek. The project code and original book icon are MIT-licensed.

Screenshots illustrate the features. Third-party trademarks, theme backgrounds, and decorative assets belong to their respective owners. Dependencies retain their own licenses; see the [license details](docs/usage-reference.md#许可).
