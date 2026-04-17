# Alert policy placeholders

Before creating policies from this directory:

1. Replace `PROJECT_ID` with your production GCP project id.
2. Replace `CHANNEL_ID` with your Monitoring notification channel id.

Example (safe temp rendering):

```bash
tmp_dir="$(mktemp -d)"
for file in ops/gcp/policies/*.json; do
  out="${tmp_dir}/$(basename "${file}")"
  sed "s/PROJECT_ID/${PROJECT_ID}/g; s/CHANNEL_ID/${CHANNEL_ID}/g" "${file}" > "${out}"
  jq empty "${out}"
done
```
