# Minab in other editors

The Minab language server works in any editor that can start a language server
over stdio. VS Code users should install the extension instead (see
`vscode-extension/README.md`).

The server gives diagnostics, completion, hover, go to definition, signature
help, document symbols, find references, rename, semantic tokens and quick fixes.
Each file uses the nearest `minab.config.json` above it, like the `minab` CLI.

## The command

The package installs a `minab-lsp` command:

```bash
minab-lsp --stdio
```

It is the same as this line, which needs no `bin` link:

```bash
node <path to the package>/out/src/language/main.js --stdio
```

`<path to the package>` is `node_modules/@shamsine/minab` in a project, the
global `npm root -g` folder, or your checkout of this repository (after
`npm run build`). The package is not on npm yet. Until it is, use a checkout:
`npm install && npm run build`, then `npm link` in the repository root gives
you `minab-lsp`.

To use one config file for all files, send `configPath` as the initialization
option. An absolute path is safest. A relative path starts at the workspace folder.

## Neovim

Add `.minab` as a file type, then register the server. With `nvim-lspconfig`:

```lua
vim.filetype.add({ extension = { minab = 'minab' } })

local configs = require('lspconfig.configs')
if not configs.minab then
  configs.minab = {
    default_config = {
      cmd = { 'minab-lsp', '--stdio' },
      filetypes = { 'minab' },
      root_dir = require('lspconfig.util').root_pattern('minab.config.json', '.git'),
      single_file_support = true,
      -- init_options = { configPath = '/path/to/minab.config.json' },
    },
  }
end
require('lspconfig').minab.setup({})
```

Neovim 0.11 and newer can do it without the plugin:

```lua
vim.filetype.add({ extension = { minab = 'minab' } })
vim.lsp.config('minab', {
  cmd = { 'minab-lsp', '--stdio' },
  filetypes = { 'minab' },
  root_markers = { 'minab.config.json', '.git' },
})
vim.lsp.enable('minab')
```

## Helix

In `~/.config/helix/languages.toml`:

```toml
[language-server.minab-lsp]
command = "minab-lsp"
args = ["--stdio"]
# config = { configPath = "/path/to/minab.config.json" }

[[language]]
name = "minab"
scope = "source.minab"
file-types = ["minab"]
roots = ["minab.config.json"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
language-servers = ["minab-lsp"]
```

Run `hx --health minab` to check that Helix finds the server.

## Zed

Zed starts a language server only from an extension. A settings file is not
enough for a new language. A small dev extension does it (Zed menu:
*Extensions*, then *Install Dev Extension*, then pick this folder).

`extension.toml`:

```toml
id = "minab"
name = "Minab"
version = "0.0.1"
schema_version = 1
authors = ["Your name"]
description = "Minab language support"
repository = "https://example.invalid/minab-zed"

[language_servers.minab-lsp]
name = "Minab language server"
languages = ["Minab"]
```

`languages/minab/config.toml`:

```toml
name = "Minab"
path_suffixes = ["minab"]
line_comments = ["// "]
block_comment = ["/* ", " */"]
```

`Cargo.toml` (crate type `cdylib`, depends on `zed_extension_api`) and
`src/lib.rs`:

```rust
use zed_extension_api::{self as zed, LanguageServerId, Result};

struct MinabExtension;

impl zed::Extension for MinabExtension {
    fn new() -> Self {
        MinabExtension
    }

    fn language_server_command(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let command = worktree
            .which("minab-lsp")
            .ok_or("minab-lsp is not on your PATH. Install the Minab package first.")?;
        Ok(zed::Command { command, args: vec!["--stdio".into()], env: vec![] })
    }
}

zed::register_extension!(MinabExtension);
```

## Check that the server works

If an editor shows nothing, test the command alone. It must wait for input and
print nothing until a client talks to it:

```bash
minab-lsp --stdio
```

Open a `.minab` file that has a type error, for example `FROM Order WHERE .status == 5`
with a config that has an `Order` table. The editor should show one error:
`"==" between TEXT and INTEGER requires an explicit CAST`.
