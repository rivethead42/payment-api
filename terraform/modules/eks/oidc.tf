# IAM OIDC provider for the cluster issuer (required for IRSA; not created automatically by Terraform).

data "tls_certificate" "eks_oidc" {
  url = module.eks.cluster_oidc_issuer_url
}

resource "aws_iam_openid_connect_provider" "eks" {
  url = module.eks.cluster_oidc_issuer_url

  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc.certificates[0].sha1_fingerprint]

  tags = var.tags
}
