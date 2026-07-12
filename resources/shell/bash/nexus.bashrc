export STARSHIP_DISABLE=1
export DISABLE_UPDATE_PROMPT=true

export PATH="${HOME}/.local/bin:${HOME}/.cursor/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

[[ -s "${HOME}/.nvm/nvm.sh" ]] && source "${HOME}/.nvm/nvm.sh"
[[ -s "${HOME}/.cargo/env" ]] && source "${HOME}/.cargo/env"

_NEXUS_ICON_PILL_LEFT=$'\ue0b6'
_NEXUS_ICON_PILL_RIGHT=$'\ue0b4'
_NEXUS_PROMPT_PILL_FG=$'\e[38;2;58;58;66m'
_NEXUS_PROMPT_PILL_BG=$'\e[48;2;58;58;66m'
_NEXUS_PROMPT_FG=$'\e[38;2;244;244;245m'
_NEXUS_PROMPT_MUTED=$'\e[38;2;139;139;150m'
_NEXUS_PROMPT_SECONDARY=$'\e[38;2;196;196;204m'
_NEXUS_PROMPT_GREEN=$'\e[38;2;74;222;128m'
_NEXUS_PROMPT_RED=$'\e[38;2;248;113;113m'
_NEXUS_PROMPT_PURPLE=$'\e[38;2;139;92;246m'
_NEXUS_PROMPT_RESET=$'\e[0m'

_nexus_prompt_esc() {
  printf '\[%s\]' "$1"
}

_nexus_prompt_seg() {
  local content="$1"
  printf '%s%s%s %s %s%s%s' \
    "$(_nexus_prompt_esc "${_NEXUS_PROMPT_PILL_FG}")" \
    "${_NEXUS_ICON_PILL_LEFT}" \
    "$(_nexus_prompt_esc "${_NEXUS_PROMPT_PILL_BG}")" \
    "$content" \
    "$(_nexus_prompt_esc "${_NEXUS_PROMPT_RESET}")" \
    "$(_nexus_prompt_esc "${_NEXUS_PROMPT_PILL_FG}")" \
    "${_NEXUS_ICON_PILL_RIGHT}$(_nexus_prompt_esc "${_NEXUS_PROMPT_RESET}")"
}

_nexus_prompt_short_path() {
  local display="${PWD/#$HOME/~}"
  local max=42
  local length=${#display}

  if (( length > max )); then
    display="…${display: -$((max - 1))}"
  fi

  printf '%s' "$display"
}

_nexus_prompt_node() {
  if command -v node >/dev/null 2>&1; then
    command node -v 2>/dev/null
  fi
}

_nexus_prompt_git() {
  local branch porcelain files=0 adds=0 dels=0
  local added deleted rest

  command git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  branch=$(command git symbolic-ref --quiet --short HEAD 2>/dev/null)
  if [[ -z "$branch" ]]; then
    branch=$(command git rev-parse --short HEAD 2>/dev/null) || return 1
  fi

  porcelain=$(command git status --porcelain --untracked-files=normal 2>/dev/null)
  if [[ -n "$porcelain" ]]; then
    files=$(printf '%s\n' "$porcelain" | grep -c .)
  fi

  while IFS=$'\t' read -r added deleted rest; do
    [[ -z "$added" || "$added" == '-' ]] && continue
    adds=$((adds + added))
    dels=$((dels + deleted))
  done < <(command git diff --numstat HEAD 2>/dev/null)

  printf '%s' "$(_nexus_prompt_seg "$(_nexus_prompt_esc "${_NEXUS_PROMPT_SECONDARY}")"$'\uf418'" $(_nexus_prompt_esc "${_NEXUS_PROMPT_FG}")${branch}")"

  if (( files > 0 || adds > 0 || dels > 0 )); then
    printf ' '
    printf '%s' "$(_nexus_prompt_seg "$(_nexus_prompt_esc "${_NEXUS_PROMPT_MUTED}")"$'\uf15b'" ${files} $(_nexus_prompt_esc "${_NEXUS_PROMPT_SECONDARY}")• $(_nexus_prompt_esc "${_NEXUS_PROMPT_GREEN}")+${adds} $(_nexus_prompt_esc "${_NEXUS_PROMPT_RED}")-${dels}")"
  fi
}

_nexus_set_prompt() {
  local segments='' path_disp node_ver git_seg

  node_ver=$(_nexus_prompt_node)
  path_disp=$(_nexus_prompt_short_path)

  if [[ -n "$node_ver" ]]; then
    segments+="$(_nexus_prompt_seg "$(_nexus_prompt_esc "${_NEXUS_PROMPT_GREEN}")"$'\ue718'" $(_nexus_prompt_esc "${_NEXUS_PROMPT_FG}")${node_ver}")"
    segments+=' '
  fi

  segments+="$(_nexus_prompt_seg "$(_nexus_prompt_esc "${_NEXUS_PROMPT_SECONDARY}")"$'\uf07b'" ${path_disp}")"

  git_seg=$(_nexus_prompt_git)
  if [[ -n "$git_seg" ]]; then
    segments+=" ${git_seg}"
  fi

  PS1="${segments}"$'\n'"$(_nexus_prompt_esc ${_NEXUS_PROMPT_PURPLE})\$"$(_nexus_prompt_esc ${_NEXUS_PROMPT_RESET}) "
}

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

PROMPT_COMMAND='_nexus_set_prompt; _nexus_emit_cwd'
_nexus_set_prompt
_nexus_emit_cwd
