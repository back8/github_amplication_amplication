provider "google" {
  project = var.project
  region  = var.region
}

provider "google-beta" {
  project = var.project
  region  = var.region
}

# APIs

resource "google_project_service" "cloud_resource_manager_api" {
  service = "cloudresourcemanager.googleapis.com"
}

resource "google_project_service" "cloud_sql" {
  service    = "sql-component.googleapis.com"
  depends_on = [google_project_service.cloud_resource_manager_api]
}

resource "google_project_service" "cloud_build_api" {
  service    = "cloudbuild.googleapis.com"
  depends_on = [google_project_service.cloud_resource_manager_api]
}

resource "google_project_service" "secret_manager_api" {
  service    = "secretmanager.googleapis.com"
  depends_on = [google_project_service.cloud_resource_manager_api]
}

# IAM

module "cloud_build_service_account" {
  source  = "../../modules/cloud_build_default_service_account"
  project = var.project
}

resource "google_project_iam_binding" "cloud_build_editor" {
  role    = "roles/editor"
  members = ["serviceAccount:${module.cloud_build_service_account.email}"]
}

# Cloud SQL

resource "random_password" "database_password" {
  length           = 16
  special          = true
  override_special = "_%@"
}

resource "google_sql_user" "database_user" {
  name     = "cloud-build"
  instance = var.database_instance
  password = random_password.database_password.result
}

# Secret Manager

resource "google_secret_manager_secret_iam_member" "secret_iam_member" {
  secret_id = var.github_client_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${module.cloud_build_service_account.email}"
}

# Cloud Build

resource "google_cloudbuild_trigger" "trigger" {
  provider    = google-beta
  name        = var.google_cloudbuild_trigger_name
  description = "Tag with ${var.github_tag}"
  github {
    owner = var.github_owner
    name  = var.github_name
    push {
      tag = var.github_tag
    }
  }
  substitutions = {
    _POSTGRESQL_USER     = google_sql_user.database_user.name
    _POSTGRESQL_PASSWORD = random_password.database_password.result
    _POSTGRESQL_DB       = var.database_name
    _DB_INSTANCE         = var.database_instance
    _IMAGE               = var.image
    _APP_BASE_IMAGE      = var.app_base_image
    _REGION              = var.region
  }
  filename = var.google_cloudbuild_trigger_filename
  tags = [
    "github-default-push-trigger"
  ]
}
