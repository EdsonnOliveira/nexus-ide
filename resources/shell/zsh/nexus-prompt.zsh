zmodload zsh/datetime 2>/dev/null

typeset -g _NEXUS_PROMPT_NODE=''
typeset -g _NEXUS_GIT_BRANCH=''
typeset -g _NEXUS_GIT_FILES=0
typeset -g _NEXUS_GIT_ADDS=0
typeset -g _NEXUS_GIT_DELS=0
typeset -g _NEXUS_CMD_START=0
typeset -g _NEXUS_LAST_DURATION=''
typeset -g _NEXUS_TRANSIENT=''
typeset -g _NEXUS_SHOW_DIVIDER=0
typeset -g PROMPT='%# '
typeset -g RPROMPT=''

typeset -g _NEXUS_PROMPT_PURPLE=$'\e[38;2;139;92;246m'
typeset -g _NEXUS_DIVIDER_FG=$'\e[38;2;72;72;82m'
typeset -g _NEXUS_TRANSIENT_FG=$'\e[1;38;2;160;160;170m'
typeset -g _NEXUS_PROMPT_RESET=$'\e[0m'

_nexus_prompt_esc() {
  print -rn -- "%{${1}%}"
}

_nexus_print_divider() {
  local cols=${COLUMNS:-80}

  if (( cols < 8 )); then
    cols=80
  fi

  print -rn -- "${_NEXUS_DIVIDER_FG}${(l:${cols}::─:)}${_NEXUS_PROMPT_RESET}"$'\n'
}

_nexus_prompt_short_path() {
  local display="${PWD/#$HOME/~}"
  local max=42

  if (( ${#display} > max )); then
    display="…${display: -$((max - 1))}"
  fi

  print -rn -- "$display"
}

_nexus_prompt_refresh_node() {
  if (( $+commands[node] )); then
    _NEXUS_PROMPT_NODE="$(command node -v 2>/dev/null)"
  else
    _NEXUS_PROMPT_NODE=''
  fi
}

_nexus_prompt_collect_git() {
  local porcelain added deleted _

  _NEXUS_GIT_BRANCH=''
  _NEXUS_GIT_FILES=0
  _NEXUS_GIT_ADDS=0
  _NEXUS_GIT_DELS=0

  command git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  _NEXUS_GIT_BRANCH="$(command git symbolic-ref --quiet --short HEAD 2>/dev/null)"
  if [[ -z "$_NEXUS_GIT_BRANCH" ]]; then
    _NEXUS_GIT_BRANCH="$(command git rev-parse --short HEAD 2>/dev/null)" || return 1
  fi

  porcelain="$(command git status --porcelain --untracked-files=normal 2>/dev/null)"
  if [[ -n "$porcelain" ]]; then
    _NEXUS_GIT_FILES=${#${(f)porcelain}}
  fi

  while IFS=$'\t' read -r added deleted _; do
    [[ -z "$added" || "$added" == '-' ]] && continue
    ((_NEXUS_GIT_ADDS += added))
    ((_NEXUS_GIT_DELS += deleted))
  done < <(command git diff --numstat HEAD 2>/dev/null)
}

_nexus_prompt_update_duration() {
  local elapsed

  _NEXUS_LAST_DURATION=''

  if (( _NEXUS_CMD_START > 0 )) && [[ -n "$EPOCHREALTIME" ]]; then
    elapsed=$(( EPOCHREALTIME - _NEXUS_CMD_START ))
    if (( elapsed < 10 )); then
      _NEXUS_LAST_DURATION=$(printf '%.3fs' "$elapsed")
    else
      _NEXUS_LAST_DURATION=$(printf '%.1fs' "$elapsed")
    fi
  fi

  _NEXUS_CMD_START=0
}

_nexus_build_transient() {
  local parts=() path_disp

  path_disp="$(_nexus_prompt_short_path)"

  if [[ -n "$_NEXUS_PROMPT_NODE" ]]; then
    parts+=("$_NEXUS_PROMPT_NODE")
  fi

  parts+=("$path_disp")

  if [[ -n "$_NEXUS_GIT_BRANCH" ]]; then
    parts+=("git:(${_NEXUS_GIT_BRANCH})")

    if (( _NEXUS_GIT_FILES > 0 || _NEXUS_GIT_ADDS > 0 || _NEXUS_GIT_DELS > 0 )); then
      parts+=("${_NEXUS_GIT_FILES} • +${_NEXUS_GIT_ADDS} -${_NEXUS_GIT_DELS}")
    fi
  fi

  if [[ -n "$_NEXUS_LAST_DURATION" ]]; then
    parts+=("(${_NEXUS_LAST_DURATION})")
  fi

  print -rn -- "$(_nexus_prompt_esc "${_NEXUS_TRANSIENT_FG}")${(j: :)parts}$(_nexus_prompt_esc "${_NEXUS_PROMPT_RESET}")"
}

_nexus_emit_prompt_info() {
  local path_disp node_ver branch_ver
  path_disp="$(_nexus_prompt_short_path)"
  node_ver="${_NEXUS_PROMPT_NODE//[$'\x1e\x1f']/}"
  branch_ver="${_NEXUS_GIT_BRANCH//[$'\x1e\x1f']/}"
  path_disp="${path_disp//[$'\x1e\x1f']/}"
  print -rn $'\x1eNEXUS_PROMPT\x1f'"${node_ver}"$'\x1f'"${path_disp}"$'\x1f'"${branch_ver}"$'\x1f'"${_NEXUS_GIT_FILES}"$'\x1f'"${_NEXUS_GIT_ADDS}"$'\x1f'"${_NEXUS_GIT_DELS}"$'\x1e'
}

_nexus_set_prompt() {
  setopt local_options no_nomatch

  _nexus_prompt_update_duration
  _nexus_prompt_refresh_node
  _nexus_prompt_collect_git

  if (( _NEXUS_SHOW_DIVIDER )); then
    _nexus_print_divider
    _NEXUS_SHOW_DIVIDER=0
  fi

  typeset -g _NEXUS_TRANSIENT="$(_nexus_build_transient)"
  typeset -g PROMPT=$'\n'"$(_nexus_prompt_esc "${_NEXUS_PROMPT_PURPLE}")%#$(_nexus_prompt_esc "${_NEXUS_PROMPT_RESET}") "
  typeset -g RPROMPT=''

  _nexus_emit_prompt_info
}

_nexus_preexec() {
  print -rn $'\x1eNEXUS_PROMPT_HIDE\x1e'
  typeset -g _NEXUS_SHOW_DIVIDER=1

  if [[ -n "$EPOCHREALTIME" ]]; then
    _NEXUS_CMD_START=$EPOCHREALTIME
  else
    _NEXUS_CMD_START=0
  fi
}

_nexus_zle_line_finish() {
  if [[ -n "$_NEXUS_TRANSIENT" ]]; then
    PROMPT="${_NEXUS_TRANSIENT}"$'\n'
    RPROMPT=''
    zle reset-prompt 2>/dev/null || true
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd _nexus_set_prompt
add-zsh-hook preexec _nexus_preexec

zle -N zle-line-finish _nexus_zle_line_finish

_nexus_set_prompt
