# EKS access entries: cluster admin for Terraform caller and optional extra principals.

data "aws_caller_identity" "current" {}

locals {
  cluster_admin_principals = distinct(concat(
    [data.aws_caller_identity.current.arn],
    var.cluster_admin_principal_arns
  ))
}

resource "aws_eks_access_entry" "cluster_admin" {
  for_each = toset(local.cluster_admin_principals)

  cluster_name  = module.eks.cluster_name
  principal_arn = each.value
  type          = "STANDARD"

  depends_on = [module.eks]
}

resource "aws_eks_access_policy_association" "cluster_admin" {
  for_each = aws_eks_access_entry.cluster_admin

  cluster_name  = module.eks.cluster_name
  principal_arn = each.value.principal_arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}
