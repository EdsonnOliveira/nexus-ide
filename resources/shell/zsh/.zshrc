export PATH="${HOME}/.local/bin:${HOME}/.cursor/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

export STARSHIP_DISABLE=1
export POWERLEVEL9K_DISABLE_CONFIGURATION=true
export POWERLEVEL9K_INSTANT_PROMPT=off
export DISABLE_UPDATE_PROMPT=true
export OMZ_DISABLE_PROMPT_FIX=true
export ZSH_THEME=''

autoload -Uz add-zsh-hook colors
colors

PROMPT_EOL_MARK=''

if [[ -f "${ZDOTDIR:-}/nexus-prompt.zsh" ]]; then
  source "${ZDOTDIR}/nexus-prompt.zsh"
elif [[ -f "${NEXUS_SHELL_DIR:-}/zsh/nexus-prompt.zsh" ]]; then
  source "${NEXUS_SHELL_DIR}/zsh/nexus-prompt.zsh"
fi

[[ -s "${HOME}/.nvm/nvm.sh" ]] && source "${HOME}/.nvm/nvm.sh"
[[ -s "${HOME}/.cargo/env" ]] && source "${HOME}/.cargo/env"

_nexus_emit_cwd() {
  print -rn $'\x1eNEXUS_CWD\x1f'"${PWD}"$'\x1e'
}

cd() {
  if builtin cd "$@"; then
    _nexus_emit_cwd
  else
    return $?
  fi
}

TRAPWINCH() {
  zle && zle -R
}

add-zsh-hook precmd _nexus_emit_cwd
add-zsh-hook chpwd _nexus_emit_cwd

_nexus_emit_cwd
