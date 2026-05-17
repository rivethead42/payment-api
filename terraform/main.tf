data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  common_tags = {
    Environment = "demo"
    Project     = "payment-api"
    ManagedBy   = "terraform"
  }
  cluster_name = "demo-eks-cluster"
}

# Dedicated VPC: public/private subnets, NAT, and IGW for EKS.
module "vpc" {
  source = "./modules/vpc"

  name     = "${local.cluster_name}-vpc"
  vpc_cidr = var.vpc_cidr
  tags     = local.common_tags
}

# ECR repository for payment-api container images.
module "ecr" {
  source = "./modules/ecr"

  repository_name = "payment-api"
  tags            = local.common_tags
}

# EKS cluster, node group, add-ons, OIDC, and access entries.
module "eks" {
  source = "./modules/eks"

  cluster_name                 = local.cluster_name
  cluster_version              = var.cluster_version
  vpc_id                       = module.vpc.vpc_id
  private_subnet_ids           = module.vpc.private_subnet_ids
  public_subnet_ids            = module.vpc.public_subnet_ids
  cluster_admin_principal_arns = var.cluster_admin_principal_arns
  tags                         = local.common_tags
}
