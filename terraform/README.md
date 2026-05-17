# payment-api demo AWS infrastructure (Terraform)

Terraform configuration for the **payment-api** demo environment: dedicated VPC, EKS **1.35** with AL2023 managed nodes, ECR repository, and supporting IAM (node ECR pull, EBS CSI IRSA, cluster access entries).

## Prerequisites

| Tool | Version |
|------|---------|
| [Terraform](https://www.terraform.io/downloads) | `>= 1.6` (see `versions.tf`) |
| [AWS CLI](https://aws.amazon.com/cli/) v2 | Configured credentials (`aws sts get-caller-identity`) |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | Compatible with Kubernetes 1.35 |
| [Docker](https://www.docker.com/) | For building and pushing images to ECR |

AWS provider constraint: `~> 5.0` (see `versions.tf`).

## Deploy

1. Change to this directory:

   ```bash
   cd terraform
   ```

2. (Optional) Copy example variables:

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

3. Initialize providers and modules:

   ```bash
   terraform init
   ```

4. Review the plan:

   ```bash
   terraform plan
   ```

5. Apply (first run typically **15–20 minutes** for VPC, NAT, EKS, and node group):

   ```bash
   terraform apply
   ```

### Ordering notes

- **vpc-cni** is installed **before** the managed node group (`before_compute`).
- **kube-proxy**, **coredns**, and **aws-ebs-csi-driver** are installed **after** nodes are ready.
- Cluster admin is granted via **explicit EKS access entries** for the Terraform caller and any ARNs in `cluster_admin_principal_arns` — not only bootstrap creator permissions.

## Push an image to ECR

After `terraform apply`, get the repository URL:

```bash
export ECR_URL=$(terraform output -raw ecr_repository_url)
export AWS_REGION=us-east-1
```

Use the same region as `var.aws_region` (default `us-east-1`, or your `terraform.tfvars` value).

Authenticate Docker to ECR:

```bash
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${ECR_URL%%/*}"
```

Build and push from the application directory:

```bash
cd ../app
docker build -t payment-api:demo .
docker tag payment-api:demo "${ECR_URL}:demo"
docker push "${ECR_URL}:demo"
```

ECR uses **immutable** tags: each new tag must be unique.

## Connect kubectl

Use the helper command from Terraform output:

```bash
$(terraform output -raw update_kubeconfig_command)
kubectl get nodes
kubectl get pods -A
```

You should see **2** AL2023 nodes in **Ready** state (private subnets, no public IPs on nodes).

## Outputs

| Output | Use |
|--------|-----|
| `eks_cluster_name` | `aws eks` / `kubectl` context |
| `eks_cluster_endpoint` | API server URL |
| `eks_cluster_certificate_authority_data` | Kubeconfig CA (sensitive) |
| `update_kubeconfig_command` | One-liner to configure `kubectl` |
| `ecr_repository_url` | CI/CD image push target |

## Destroy

```bash
terraform destroy
```

Ensure no LoadBalancer services or other resources block VPC/subnet deletion.

## Layout

```text
terraform/
├── main.tf              # Root module wiring
├── variables.tf
├── outputs.tf
├── providers.tf
├── versions.tf
└── modules/
    ├── vpc/             # VPC, subnets, NAT, IGW
    ├── eks/             # EKS, nodes, add-ons, OIDC, access entries
    └── ecr/             # payment-api repository
```
