typeset -g PROMPT='%~ %# '
typeset -g RPROMPT=''

export PATH="${HOME}/.local/bin:${HOME}/.cursor/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

export STARSHIP_DISABLE=1
export POWERLEVEL9K_DISABLE_CONFIGURATION=true
export POWERLEVEL9K_INSTANT_PROMPT=off
export DISABLE_UPDATE_PROMPT=true
export OMZ_DISABLE_PROMPT_FIX=true
export ZSH_THEME=''

[[ -s "${HOME}/.nvm/nvm.sh" ]] && source "${HOME}/.nvm/nvm.sh"
[[ -s "${HOME}/.cargo/env" ]] && source "${HOME}/.cargo/env"

autoload -Uz add-zsh-hook colors
colors

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

chpwd_functions=(_nexus_emit_cwd)
precmd_functions=(_nexus_emit_cwd)

TRAPWINCH() {
  zle && zle -R
}

_nexus_emit_cwd
