#!/usr/bin/env bash
# Verifies the planned BMA exec-server environment holds no admin credentials
# or unintended permissions. Run in WSL from the repo root:
#   bash harness/check-exec-env.sh
#
# What it checks (the exec-server itself cannot attach until the account has BMA access):
#  1. The container the exec-server would run in: only the workspace, the Codex
#     binary (read-only) and a short-lived CocBmaEnvRole credential file are mounted.
#     No ~/.aws of the operator, no SSO cache, no docker socket, no admin profile.
#  2. What that credential file can actually do in AWS: identity only. Every
#     other probe (S3, IAM, Lambda, logs, gateway, role assumption) must be denied.
# Prints PASS/FAIL lines and writes a redacted JSON report. Exit 0 only if all pass.

set -euo pipefail

OPERATOR_PROFILE="${OPERATOR_PROFILE:-${AWS_PROFILE:?set AWS_PROFILE (operator SSO profile) or OPERATOR_PROFILE}}"
REGION=us-east-1
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$HOME/coc-t09/exec-env-check"
CREDS_DIR="$WORK/aws"
WORKSPACE="$WORK/workspace"
CODEX_BIN="$(dirname "$(readlink -f "$(command -v codex)")")/../node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex"
IMAGE=node:22-alpine
REPORT="$REPO/docs/research/t09-evidence/exec-env-check.json"

cleanup() { rm -rf "$CREDS_DIR"; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$CREDS_DIR" "$WORKSPACE/skills"; chmod 700 "$CREDS_DIR"
[[ -x "$CODEX_BIN" ]] || { echo "codex static binary not found"; exit 2; }

ACCT=$(AWS_PROFILE="$OPERATOR_PROFILE" aws sts get-caller-identity --query Account --output text)
ENV_ROLE="arn:aws:iam::${ACCT}:role/CocBmaEnvRole"
GATEWAY_URL=$(node -e "console.log(require('$REPO/.local/stage-b.json').gatewayUrl)" 2>/dev/null || echo "")

# Short-lived environment-role credentials, written only into the mount directory.
read -r AK SK ST < <(AWS_PROFILE="$OPERATOR_PROFILE" aws sts assume-role --role-arn "$ENV_ROLE" \
  --role-session-name coc-exec-env-check --duration-seconds 900 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
umask 077
printf '[coc-env]\naws_access_key_id = %s\naws_secret_access_key = %s\naws_session_token = %s\n' "$AK" "$SK" "$ST" > "$CREDS_DIR/credentials"
printf '[profile coc-env]\nregion = %s\n' "$REGION" > "$CREDS_DIR/config"
unset AK SK ST

results=()
skipped=()
record() { # name pass detail
  local status=FAIL; [[ "$2" == "1" ]] && status=PASS
  printf '%s  %s  %s\n' "$status" "$1" "$3"
  results+=("$(jq -cn --arg n "$1" --argjson p "$([[ "$2" == 1 ]] && echo true || echo false)" --arg d "$3" '{name:$n,pass:$p,detail:$d}')")
}

# ---- 1. Container contents -------------------------------------------------
INSIDE=$(docker run --rm \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp \
  -e AWS_PROFILE=coc-env -e AWS_CONFIG_FILE=/home/node/.aws/config -e AWS_SHARED_CREDENTIALS_FILE=/home/node/.aws/credentials \
  -v "$CODEX_BIN":/opt/codex/codex:ro \
  -v "$WORKSPACE":/workspace \
  -v "$CREDS_DIR":/home/node/.aws:ro \
  "$IMAGE" sh -c '
    echo "ENVNAMES=$(env | cut -d= -f1 | sort | tr "\n" " ")"
    echo "AWSENV=$(env | grep -E "^AWS_" | cut -d= -f1 | sort | tr "\n" " ")"
    echo "AWSDIR=$(ls -A /home/node/.aws | tr "\n" " ")"
    echo "PROFILES=$(grep -h "^\[" /home/node/.aws/config /home/node/.aws/credentials | tr "\n" " ")"
    echo "SSOCACHE=$(ls -A /home/node/.aws/sso 2>/dev/null | wc -l)"
    echo "ADMINREF=$(grep -rl -i "AdministratorAccess\|sso_start_url" /home/node/.aws 2>/dev/null | wc -l)"
    echo "OPERATORHOME=$(ls -d /home/keith /mnt/c /mnt/d /root/.aws 2>/dev/null | tr "\n" " ")"
    echo "DOCKERSOCK=$(ls /var/run/docker.sock 2>/dev/null | wc -l)"
    echo "UID=$(id -u)"
    echo "CODEXRO=$(touch /opt/codex/codex 2>/dev/null && echo writable || echo readonly)"
    echo "IMDS=$(wget -q -T 2 -O - http://169.254.169.254/latest/meta-data/ 2>/dev/null | head -c 20 | wc -c)"
  ')
val() { grep "^$1=" <<<"$INSIDE" | cut -d= -f2-; }

[[ "$(val AWSENV)" == "AWS_CONFIG_FILE AWS_PROFILE AWS_SHARED_CREDENTIALS_FILE " ]] && p=1 || p=0
record "container: only the env-role profile variables, no key variables" $p "$(val AWSENV)"
[[ "$(val PROFILES)" == "[profile coc-env] [coc-env] " ]] && p=1 || p=0
record "container: only the coc-env profile is present" $p "$(val PROFILES)"
[[ "$(val SSOCACHE)" == "0" && "$(val ADMINREF)" == "0" ]] && p=1 || p=0
record "container: no SSO cache and no admin profile reference" $p "sso=$(val SSOCACHE) adminRefs=$(val ADMINREF)"
[[ -z "$(val OPERATORHOME | tr -d ' ')" ]] && p=1 || p=0
record "container: operator home, Windows drives and root .aws not mounted" $p "found='$(val OPERATORHOME)'"
[[ "$(val DOCKERSOCK)" == "0" ]] && p=1 || p=0
record "container: no docker socket" $p "$(val DOCKERSOCK)"
[[ "$(val UID)" == "1000" && "$(val CODEXRO)" == "readonly" ]] && p=1 || p=0
record "container: non-root user and read-only Codex binary" $p "uid=$(val UID) codex=$(val CODEXRO)"
[[ "$(val IMDS)" == "0" ]] && p=1 || p=0
record "container: no instance metadata credentials reachable" $p "bytes=$(val IMDS)"

# ---- 2. What the mounted credentials can do in AWS --------------------------
export AWS_CONFIG_FILE="$CREDS_DIR/config" AWS_SHARED_CREDENTIALS_FILE="$CREDS_DIR/credentials" AWS_PROFILE=coc-env
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

ID=$(aws sts get-caller-identity --query Arn --output text 2>&1 || true)
[[ "$ID" == *":assumed-role/CocBmaEnvRole/"* ]] && p=1 || p=0
record "credentials: identity is CocBmaEnvRole" $p "$(sed -E 's/[0-9]{12}/<acct>/' <<<"$ID")"

denied() { # name, command...
  local name="$1"; shift
  local out; out=$("$@" 2>&1) && { record "credentials: $name denied" 0 "UNEXPECTEDLY ALLOWED"; return; }
  if grep -qiE "AccessDenied|not authorized|UnauthorizedOperation|Forbidden|403" <<<"$out"; then
    record "credentials: $name denied" 1 "$(grep -oiE "AccessDenied[A-Za-z]*|not authorized|Forbidden" <<<"$out" | head -1)"
  else
    record "credentials: $name denied" 0 "unexpected error: $(head -c 160 <<<"$out")"
  fi
}
denied "s3 list buckets"            aws s3api list-buckets
denied "iam list roles"             aws iam list-roles --max-items 1
denied "lambda invoke stub"         aws lambda invoke --region $REGION --function-name coc-t09-evidence-tools /dev/null
denied "logs read stub logs"        aws logs filter-log-events --region $REGION --log-group-name /aws/lambda/coc-t09-evidence-tools --limit 1
denied "assume harness role"        aws sts assume-role --role-arn "arn:aws:iam::${ACCT}:role/CocT09HarnessRole" --role-session-name coc-probe
denied "assume BMA session role"    aws sts assume-role --role-arn "arn:aws:iam::${ACCT}:role/CocBmaSessionRole" --role-session-name coc-probe
denied "bedrock model listing"      aws bedrock list-foundation-models --region $REGION
denied "agentcore list gateways"    aws bedrock-agentcore-control list-gateways --region $REGION
if [[ -n "$GATEWAY_URL" ]]; then
  eval "$(aws configure export-credentials --format env)"
  CODE=$(printf 'user = "%s:%s"\nheader = "x-amz-security-token: %s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" | \
    curl -sS -o /dev/null -w '%{http_code}' -K - --aws-sigv4 "aws:amz:$REGION:bedrock-agentcore" -H 'Content-Type: application/json' \
    --data-raw '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "$GATEWAY_URL")
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  if [[ "$CODE" == "404" ]]; then
    # The gateway in .local/stage-b.json no longer exists (torn down). Not a pass, not a fail.
    printf 'SKIP  credentials: invoke the tool gateway denied  gateway not found (http=404); run while a gateway exists\n'
    skipped=("$(jq -cn --arg d "http=404: gateway deleted" '{name:"credentials: invoke the tool gateway denied",skipped:true,detail:$d}')")
  else
    [[ "$CODE" == "403" || "$CODE" == "401" ]] && p=1 || p=0
    record "credentials: invoke the tool gateway denied" $p "http=$CODE"
  fi
fi

# ---- Report -----------------------------------------------------------------
mkdir -p "$(dirname "$REPORT")"
SKIPPED_JSON=$(printf '%s\n' "${skipped[@]:-}" | jq -s '[.[] | select(. != null)]' 2>/dev/null || echo '[]')
printf '%s\n' "${results[@]}" | jq -s --arg at "$(date -u +%FT%TZ)" --argjson sk "$SKIPPED_JSON" \
  '{ranAt:$at, note:"Exec-server container and CocBmaEnvRole credential checks. The exec-server itself was not attached (no BMA access).", checks:., skipped:$sk, summary:{passed:([.[]|select(.pass)]|length), total:length, skipped:($sk|length)}}' > "$REPORT"
TOTAL=${#results[@]}; PASSED=$(jq '.summary.passed' "$REPORT")
echo; echo "$PASSED/$TOTAL passed"
[[ "$PASSED" == "$TOTAL" ]]
