# EKS cluster and managed node group (AL2023, private subnets). vpc-cni installs before nodes.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  vpc_id     = var.vpc_id
  subnet_ids = concat(var.private_subnet_ids, var.public_subnet_ids)

  authentication_mode = "API_AND_CONFIG_MAP"

  # Explicit access entries in access.tf — do not rely on creator bootstrap alone.
  enable_cluster_creator_admin_permissions = false

  # OIDC provider created explicitly in oidc.tf for IRSA.
  enable_irsa = false

  cluster_endpoint_public_access = true

  cluster_addons = {
    vpc-cni = {
      most_recent    = true
      before_compute = true
    }
  }

  eks_managed_node_groups = {
    demo = {
      name            = "demo"
      ami_type        = "AL2023_x86_64_STANDARD"
      instance_types  = ["t3.medium"]
      min_size        = 1
      max_size        = 3
      desired_size    = 2
      subnet_ids      = var.private_subnet_ids
      create_iam_role = false
      iam_role_arn    = aws_iam_role.eks_node.arn
    }
  }

  tags = var.tags
}
