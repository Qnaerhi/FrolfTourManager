# Emergency cost kill switch

Use this procedure if spend spikes or the service is under active abuse.

## 1. Block new edge traffic

Disable load balancer access immediately:

```bash
gcloud compute forwarding-rules delete YOUR_HTTPS_FORWARDING_RULE --global --quiet
```

If deleting the forwarding rule is too disruptive, attach a deny-all temporary
Cloud Armor rule at highest priority.

## 2. Stop Cloud Run serving capacity

```bash
gcloud run services update frolf-tour-api --region=europe-north1 --max-instances=0
```

## 3. Pause any scheduled workload

```bash
gcloud scheduler jobs pause --location=europe-north1 YOUR_JOB_NAME
```

## 4. Confirm spend trend falls

- Check Billing Reports (last 1h and 6h).
- Check Cloud Run request count.
- Check Cloud Armor hit counts.

## 5. Recover safely

1. Identify root cause (abuse, deployment loop, bot traffic, or bug).
2. Apply mitigation (tighter rate limits, fixed deployment, blocked source).
3. Restore capacity gradually (`max-instances=1`, then 2+ as needed).
