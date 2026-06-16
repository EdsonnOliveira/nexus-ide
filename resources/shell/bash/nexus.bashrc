export STARSHIP_DISABLE=1
export DISABLE_UPDATE_PROMPT=true

PS1='\w \$ '

[[ -s "${HOME}/.nvm/nvm.sh" ]] && source "${HOME}/.nvm/nvm.sh"
[[ -s "${HOME}/.cargo/env" ]] && source "${HOME}/.cargo/env"

_nexus_emit_cwd() {
  printf $'\x1eNEXUS_CWD\x1f%s\x1e' "$PWD"
}

cd() {
  if builtin cd "$@"; then
    _nexus_emit_cwd
  else
    return $?
  fi
}

PROMPT_COMMAND="_nexus_emit_cwd"
_nexus_emit_cwd
