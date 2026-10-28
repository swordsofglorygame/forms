from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import (
    Flask, abort, flash, make_response, redirect, render_template, request,
    url_for,
)
from flask_login import (
    LoginManager, UserMixin, current_user, login_required, login_user, logout_user,
)
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import URL, text as sql_text
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
ALLOWED_ROLES = {"admin", "creator", "reviewer", "viewer"}
ROLE_LABELS = {
    "admin": "مدير كامل",
    "creator": "منشئ نماذج",
    "reviewer": "مراجع طلبات",
    "viewer": "مشاهد",
}
FIELD_TYPES = {"text", "textarea", "number", "email", "url", "tel", "date", "select", "checkbox"}
FIELD_TYPE_LABELS = {
    "text": "نص قصير",
    "textarea": "نص طويل",
    "number": "رقم",
    "email": "بريد إلكتروني",
    "url": "رابط",
    "tel": "هاتف / وسيلة تواصل",
    "date": "تاريخ",
    "select": "قائمة اختيار",
    "checkbox": "موافقة / مربع اختيار",
}
SUBMISSION_STATUSES = {
    "pending": "قيد المراجعة",
    "approved": "مقبول",
    "rejected": "مرفوض",
}


db = SQLAlchemy()
login_manager = LoginManager()
csrf = CSRFProtect()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(120), nullable=False, default="")
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(24), nullable=False, default="viewer")
    active = db.Column(db.Boolean, nullable=False, default=True)
    can_moderate = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)


class Form(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(180), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, nullable=False, default="")
    is_public = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class FormField(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    form_id = db.Column(db.Integer, db.ForeignKey("form.id", ondelete="CASCADE"), nullable=False, index=True)
    field_key = db.Column(db.String(80), nullable=False, unique=True)
    label = db.Column(db.String(180), nullable=False)
    field_type = db.Column(db.String(24), nullable=False, default="text")
    required = db.Column(db.Boolean, nullable=False, default=False)
    options = db.Column(db.Text, nullable=False, default="")
    position = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)


class FormPermission(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    form_id = db.Column(db.Integer, db.ForeignKey("form.id", ondelete="CASCADE"), nullable=False)
    can_read = db.Column(db.Boolean, nullable=False, default=False)
    can_results = db.Column(db.Boolean, nullable=False, default=False)
    can_edit = db.Column(db.Boolean, nullable=False, default=False)
    can_manage = db.Column(db.Boolean, nullable=False, default=False)
    __table_args__ = (db.UniqueConstraint("user_id", "form_id", name="uq_form_permission_user_form"),)


class Submission(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    form_id = db.Column(db.Integer, db.ForeignKey("form.id", ondelete="CASCADE"), nullable=False, index=True)
    # A snapshot keeps submitted labels/values readable even if fields are later changed or removed.
    data_json = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(24), nullable=False, default="pending")
    review_note = db.Column(db.Text, nullable=False, default="")
    submitted_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    reviewed_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    action = db.Column(db.String(100), nullable=False)
    entity_type = db.Column(db.String(80), nullable=False, default="")
    entity_id = db.Column(db.String(80), nullable=False, default="")
    details = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)


class ModerationAction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    action_type = db.Column(db.String(20), nullable=False)  # chat or mail
    player_uid = db.Column(db.String(100), nullable=False)
    player_name = db.Column(db.String(120), nullable=False, default="")
    server = db.Column(db.String(100), nullable=False)
    duration = db.Column(db.String(30), nullable=False)
    reason = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(24), nullable=False, default="pending")
    result_note = db.Column(db.Text, nullable=False, default="")
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    updated_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(BASE_DIR / "data", exist_ok=True)
    os.makedirs(app.instance_path, exist_ok=True)

    secret = os.environ.get("SECRET_KEY", "local-development-key-change-before-deploy")
    if os.environ.get("APP_ENV", "").lower() == "production" and (
        secret == "local-development-key-change-before-deploy" or secret.startswith("CHANGE_TO")
    ):
        raise RuntimeError("Set a strong SECRET_KEY environment variable for production.")

    db_url = os.environ.get("DATABASE_URL", "").strip()
    if db_url.startswith("postgres://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgres://"):]
    elif db_url.startswith("postgresql://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgresql://"):]
    if not db_url:
        # This is created automatically when the app first runs. It is not a GitHub source file.
        db_url = URL.create("sqlite", database=str(BASE_DIR / "data" / "sog_moderator_portal.db"))

    app.config.from_mapping(
        SECRET_KEY=secret,
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
        WTF_CSRF_TIME_LIMIT=3600,
        ADMIN_USERNAME=os.environ.get("ADMIN_USERNAME", "admin"),
        ADMIN_PASSWORD=os.environ.get("ADMIN_PASSWORD", ""),
        TESTING=False,
    )
    if test_config:
        app.config.update(test_config)

    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message = "سجّل الدخول للوصول إلى لوحة التحكم."
    login_manager.login_message_category = "info"
    csrf.init_app(app)

    @login_manager.user_loader
    def load_user(user_id: str) -> User | None:
        try:
            return db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            return None

    @login_manager.request_loader
    def load_inactive_user(_request):
        return None

    with app.app_context():
        db.create_all()
        if User.query.filter_by(role="admin").count() == 0:
            password = str(app.config.get("ADMIN_PASSWORD") or "")
            if len(password) < 12 or password.upper().startswith("CHANGE_TO"):
                if app.config.get("TESTING"):
                    password = "test-admin-password-2026"
                else:
                    raise RuntimeError(
                        "لا يوجد مدير في قاعدة البيانات. اضبط ADMIN_PASSWORD في ملف .env "
                        "على كلمة مرور لا تقل عن 12 حرفًا ثم أعد تشغيل التطبيق."
                    )
            admin = User(
                username=str(app.config.get("ADMIN_USERNAME") or "admin").strip() or "admin",
                display_name="مدير النظام",
                role="admin",
                active=True,
            )
            admin.set_password(password)
            db.session.add(admin)
            db.session.commit()

    @app.context_processor
    def inject_template_helpers():
        return {
            "role_labels": ROLE_LABELS,
            "field_type_labels": FIELD_TYPE_LABELS,
            "submission_statuses": SUBMISSION_STATUSES,
            "can_access": can_access,
            "utcnow": utcnow,
        }

    @app.before_request
    def reject_disabled_accounts():
        if current_user.is_authenticated and not current_user.active:
            logout_user()
            flash("هذا الحساب معطّل. تواصل مع مدير النظام.", "error")
            return redirect(url_for("login"))

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.path.startswith("/admin") or request.path == "/dashboard":
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.route("/healthz")
    def healthz():
        try:
            db.session.execute(sql_text("SELECT 1"))
            return {"status": "ok"}, 200
        except Exception:
            app.logger.exception("Health check failed")
            return {"status": "error"}, 503

    @app.route("/")
    def index():
        forms = Form.query.filter_by(is_public=True, is_active=True).order_by(Form.created_at.desc()).all()
        return render_template("index.html", forms=forms)

    @app.route("/apply/<slug>", methods=["GET", "POST"])
    def apply_form(slug: str):
        form = Form.query.filter_by(slug=slug, is_public=True, is_active=True).first_or_404()
        fields = FormField.query.filter_by(form_id=form.id, is_active=True).order_by(FormField.position, FormField.id).all()
        if request.method == "POST":
            submitted_values: list[dict[str, str]] = []
            errors: list[str] = []
            if not fields:
                errors.append("هذا النموذج لم تُضف إليه حقول بعد.")
            for field in fields:
                value = read_field_value(field, request.form)
                if field.required and (not value.strip() or (field.field_type == "checkbox" and value != "نعم")):
                    errors.append(f"الحقل «{field.label}» مطلوب.")
                if field.field_type == "select" and value and value not in [x.strip() for x in field.options.splitlines() if x.strip()]:
                    errors.append(f"القيمة المختارة في «{field.label}» غير صالحة.")
                if field.field_type == "email" and value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
                    errors.append(f"البريد الإلكتروني في «{field.label}» غير صحيح.")
                if len(value) > 5000:
                    errors.append(f"الحقل «{field.label}» طويل جدًا.")
                submitted_values.append({"key": field.field_key, "label": field.label, "value": value})
            if errors:
                return render_template("apply.html", form=form, fields=fields, errors=errors, values=request.form), 400
            submission = Submission(form_id=form.id, data_json=json.dumps(submitted_values, ensure_ascii=False))
            db.session.add(submission)
            db.session.commit()
            return render_template("success.html", form=form)
        return render_template("apply.html", form=form, fields=fields, errors=[], values={})

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = User.query.filter_by(username=username).first()
            if user and user.active and user.check_password(password):
                login_user(user, remember=False, fresh=True)
                return redirect(url_for("dashboard"))
            flash("اسم المستخدم أو كلمة المرور غير صحيحة.", "error")
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        logout_user()
        flash("تم تسجيل الخروج.", "success")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        if current_user.role == "admin":
            forms = Form.query.order_by(Form.created_at.desc()).all()
        else:
            forms = []
            for form in Form.query.order_by(Form.created_at.desc()).all():
                if can_access(form.id, "read") or can_access(form.id, "results") or can_access(form.id, "edit"):
                    forms.append(form)
        return render_template("dashboard.html", forms=forms)

    @app.route("/admin/forms/new", methods=["GET", "POST"])
    @login_required
    def new_form():
        if current_user.role not in {"admin", "creator"}:
            abort(403)
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            description = request.form.get("description", "").strip()
            slug = unique_slug(request.form.get("slug", "").strip() or name)
            if not name:
                flash("اكتب اسم النموذج.", "error")
                return render_template("form_new.html", values=request.form)
            if len(name) > 180:
                flash("اسم النموذج طويل جدًا.", "error")
                return render_template("form_new.html", values=request.form)
            form = Form(
                name=name,
                slug=slug,
                description=description[:5000],
                is_public=checked("is_public"),
                is_active=checked("is_active"),
                owner_id=current_user.id,
            )
            db.session.add(form)
            db.session.flush()
            if current_user.role != "admin":
                db.session.add(FormPermission(
                    user_id=current_user.id,
                    form_id=form.id,
                    can_read=True,
                    can_results=True,
                    can_edit=True,
                    can_manage=True,
                ))
            audit("form.created", "form", form.id, f"Created form {form.name}")
            db.session.commit()
            flash("تم إنشاء النموذج. أضف الحقول التي تريدها من صفحة إعداد النموذج.", "success")
            return redirect(url_for("edit_form", form_id=form.id))
        return render_template("form_new.html", values={})

    @app.route("/admin/forms/<int:form_id>")
    @login_required
    def form_overview(form_id: int):
        form = db.get_or_404(Form, form_id)
        if not can_access(form_id, "read") and not can_access(form_id, "results") and not can_access(form_id, "edit"):
            abort(403)
        fields = FormField.query.filter_by(form_id=form.id).order_by(FormField.position, FormField.id).all()
        count = Submission.query.filter_by(form_id=form.id).count() if can_access(form.id, "results") else None
        return render_template("form_overview.html", form=form, fields=fields, submission_count=count)

    @app.route("/admin/forms/<int:form_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_form(form_id: int):
        form = db.get_or_404(Form, form_id)
        if not can_access(form_id, "edit"):
            abort(403)
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            raw_slug = request.form.get("slug", "").strip() or name
            slug = unique_slug(raw_slug, exclude_form_id=form.id)
            if not name:
                flash("اسم النموذج مطلوب.", "error")
            else:
                form.name = name[:180]
                form.slug = slug
                form.description = request.form.get("description", "").strip()[:5000]
                form.is_public = checked("is_public")
                form.is_active = checked("is_active")
                form.updated_at = utcnow()
                audit("form.updated", "form", form.id, f"Updated form {form.name}")
                db.session.commit()
                flash("تم حفظ إعدادات النموذج.", "success")
                return redirect(url_for("edit_form", form_id=form.id))
        fields = FormField.query.filter_by(form_id=form.id).order_by(FormField.position, FormField.id).all()
        return render_template("form_edit.html", form=form, fields=fields)

    @app.post("/admin/forms/<int:form_id>/fields/add")
    @login_required
    def add_field(form_id: int):
        form = db.get_or_404(Form, form_id)
        if not can_access(form_id, "edit"):
            abort(403)
        label = request.form.get("label", "").strip()
        field_type = request.form.get("field_type", "text").strip()
        options = request.form.get("options", "").strip()
        if not label:
            flash("اسم الحقل مطلوب.", "error")
        elif field_type not in FIELD_TYPES:
            flash("نوع الحقل غير مدعوم.", "error")
        elif field_type == "select" and not any(x.strip() for x in options.splitlines()):
            flash("أدخل خيارًا واحدًا على الأقل للقائمة.", "error")
        elif FormField.query.filter_by(form_id=form.id, label=label).first():
            flash("يوجد حقل بهذا الاسم بالفعل في النموذج. اختر اسمًا مختلفًا.", "error")
        else:
            current_max = db.session.query(db.func.max(FormField.position)).filter_by(form_id=form.id).scalar()
            field = FormField(
                form_id=form.id,
                field_key=f"field_{secrets.token_hex(8)}",
                label=label[:180],
                field_type=field_type,
                required=checked("required"),
                options=options[:5000],
                position=(current_max if current_max is not None else -1) + 1,
                is_active=True,
            )
            db.session.add(field)
            audit("field.created", "form_field", field.field_key, f"Added field {field.label} to form {form.name}")
            db.session.commit()
            flash("تمت إضافة الحقل.", "success")
        return redirect(url_for("edit_form", form_id=form.id))

    @app.post("/admin/forms/<int:form_id>/fields/<int:field_id>/edit")
    @login_required
    def update_field(form_id: int, field_id: int):
        form = db.get_or_404(Form, form_id)
        field = db.get_or_404(FormField, field_id)
        if field.form_id != form.id:
            abort(404)
        if not can_access(form_id, "edit"):
            abort(403)
        label = request.form.get("label", "").strip()
        field_type = request.form.get("field_type", "text").strip()
        options = request.form.get("options", "").strip()
        duplicate = FormField.query.filter(FormField.form_id == form.id, FormField.label == label, FormField.id != field.id).first()
        if not label or field_type not in FIELD_TYPES or duplicate:
            flash("راجع اسم الحقل ونوعه؛ الاسم يجب أن يكون غير مكرر.", "error")
        elif field_type == "select" and not any(x.strip() for x in options.splitlines()):
            flash("أدخل خيارًا واحدًا على الأقل للقائمة.", "error")
        else:
            field.label = label[:180]
            field.field_type = field_type
            field.options = options[:5000]
            field.required = checked("required")
            field.is_active = checked("is_active")
            try:
                field.position = max(0, min(10000, int(request.form.get("position", field.position))))
            except (TypeError, ValueError):
                pass
            audit("field.updated", "form_field", field.field_key, f"Updated field in form {form.name}")
            db.session.commit()
            flash("تم تحديث الحقل.", "success")
        return redirect(url_for("edit_form", form_id=form.id))

    @app.post("/admin/forms/<int:form_id>/fields/<int:field_id>/delete")
    @login_required
    def delete_field(form_id: int, field_id: int):
        form = db.get_or_404(Form, form_id)
        field = db.get_or_404(FormField, field_id)
        if field.form_id != form.id:
            abort(404)
        if not can_access(form_id, "edit"):
            abort(403)
        # Existing applications keep a label/value snapshot and remain readable.
        audit("field.deleted", "form_field", field.field_key, f"Deleted field from form {form.name}")
        db.session.delete(field)
        db.session.commit()
        flash("تم حذف الحقل. بيانات الطلبات القديمة محفوظة في نتائجها.", "success")
        return redirect(url_for("edit_form", form_id=form.id))

    @app.route("/admin/forms/<int:form_id>/results")
    @login_required
    def form_results(form_id: int):
        form = db.get_or_404(Form, form_id)
        if not can_access(form_id, "results"):
            abort(403)
        submissions = Submission.query.filter_by(form_id=form.id).order_by(Submission.submitted_at.desc(), Submission.id.desc()).all()
        fields = build_result_columns(form, submissions)
        rows = []
        for submission in submissions:
            try:
                values = json.loads(submission.data_json)
            except (json.JSONDecodeError, TypeError):
                values = []
            value_map = {item.get("key"): item.get("value", "") for item in values if isinstance(item, dict)}
            rows.append({"submission": submission, "values": value_map})
        return render_template("results.html", form=form, fields=fields, rows=rows)

    @app.route("/admin/forms/<int:form_id>/results.csv")
    @login_required
    def export_results(form_id: int):
        form = db.get_or_404(Form, form_id)
        if not can_access(form_id, "results"):
            abort(403)
        submissions = Submission.query.filter_by(form_id=form.id).order_by(Submission.id.asc()).all()
        fields = build_result_columns(form, submissions)
        out = io.StringIO(newline="")
        writer = csv.writer(out)
        writer.writerow(["رقم الطلب"] + [f["label"] for f in fields] + ["الحالة", "تاريخ التقديم", "ملاحظة المراجعة"])
        for s in submissions:
            try:
                data = json.loads(s.data_json)
            except (json.JSONDecodeError, TypeError):
                data = []
            values = {item.get("key"): item.get("value", "") for item in data if isinstance(item, dict)}
            writer.writerow([s.id] + [values.get(f["key"], "") for f in fields] + [SUBMISSION_STATUSES.get(s.status, s.status), s.submitted_at.strftime("%Y-%m-%d %H:%M UTC"), s.review_note])
        response = make_response("\ufeff" + out.getvalue())
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = f'attachment; filename="form-{form.id}-results.csv"'
        return response

    @app.post("/admin/submissions/<int:submission_id>/review")
    @login_required
    def review_submission(submission_id: int):
        submission = db.get_or_404(Submission, submission_id)
        if not can_access(submission.form_id, "results"):
            abort(403)
        status = request.form.get("status", "pending")
        if status not in SUBMISSION_STATUSES:
            abort(400)
        submission.status = status
        submission.review_note = request.form.get("review_note", "").strip()[:5000]
        submission.reviewed_by = current_user.id
        submission.reviewed_at = utcnow()
        audit("submission.reviewed", "submission", submission.id, f"Status changed to {status}")
        db.session.commit()
        flash("تم تحديث حالة الطلب.", "success")
        return redirect(url_for("form_results", form_id=submission.form_id))

    @app.route("/admin/users")
    @login_required
    def users():
        require_admin()
        users_list = User.query.order_by(User.id.asc()).all()
        return render_template("users.html", users=users_list)

    @app.post("/admin/users/new")
    @login_required
    def create_user():
        require_admin()
        username = request.form.get("username", "").strip()
        display_name = request.form.get("display_name", "").strip()
        password = request.form.get("password", "")
        role = request.form.get("role", "viewer")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,80}", username):
            flash("اسم المستخدم يجب أن يكون 3 أحرف على الأقل، وبأحرف إنجليزية أو أرقام أو . _ - فقط.", "error")
        elif User.query.filter_by(username=username).first():
            flash("اسم المستخدم مستخدم بالفعل.", "error")
        elif len(password) < 12:
            flash("كلمة المرور يجب أن تكون 12 حرفًا على الأقل.", "error")
        elif role not in ALLOWED_ROLES:
            flash("مستوى الصلاحية غير صالح.", "error")
        else:
            user = User(
                username=username,
                display_name=display_name[:120],
                role=role,
                active=True,
                can_moderate=checked("can_moderate"),
            )
            user.set_password(password)
            db.session.add(user)
            db.session.flush()
            audit("user.created", "user", user.id, f"Created user {user.username} with role {role}")
            db.session.commit()
            flash("تم إنشاء المستخدم. حدد له صلاحيات النماذج من صفحة الصلاحيات.", "success")
            return redirect(url_for("user_permissions", user_id=user.id))
        return redirect(url_for("users"))

    @app.post("/admin/users/<int:user_id>/save")
    @login_required
    def save_user(user_id: int):
        require_admin()
        user = db.get_or_404(User, user_id)
        new_role = request.form.get("role", "viewer")
        if new_role not in ALLOWED_ROLES:
            abort(400)
        new_active = checked("active")
        if user.id == current_user.id and (not new_active or new_role != "admin"):
            flash("لا يمكنك تعطيل حسابك الحالي أو إزالة صلاحية المدير منه.", "error")
            return redirect(url_for("users"))
        if user.role == "admin" and (not new_active or new_role != "admin"):
            active_admins = User.query.filter_by(role="admin", active=True).count()
            if user.active and active_admins <= 1:
                flash("لا يمكن تعطيل أو تخفيض صلاحية آخر مدير نشط.", "error")
                return redirect(url_for("users"))
        user.display_name = request.form.get("display_name", "").strip()[:120]
        user.role = new_role
        user.active = new_active
        user.can_moderate = checked("can_moderate")
        password = request.form.get("password", "")
        if password:
            if len(password) < 12:
                flash("كلمة المرور الجديدة يجب أن تكون 12 حرفًا على الأقل.", "error")
                return redirect(url_for("users"))
            user.set_password(password)
        audit("user.updated", "user", user.id, f"Updated user {user.username}")
        db.session.commit()
        flash("تم حفظ المستخدم.", "success")
        return redirect(url_for("users"))

    @app.route("/admin/users/<int:user_id>/permissions", methods=["GET", "POST"])
    @login_required
    def user_permissions(user_id: int):
        require_admin()
        user = db.get_or_404(User, user_id)
        forms = Form.query.order_by(Form.created_at.desc()).all()
        if request.method == "POST":
            for form in forms:
                p = FormPermission.query.filter_by(user_id=user.id, form_id=form.id).first()
                values = {
                    "can_read": bool(request.form.get(f"read_{form.id}")),
                    "can_results": bool(request.form.get(f"results_{form.id}")),
                    "can_edit": bool(request.form.get(f"edit_{form.id}")),
                    "can_manage": bool(request.form.get(f"manage_{form.id}")),
                }
                if not p:
                    p = FormPermission(user_id=user.id, form_id=form.id)
                    db.session.add(p)
                p.can_read = values["can_read"]
                p.can_results = values["can_results"]
                p.can_edit = values["can_edit"]
                p.can_manage = values["can_manage"]
            audit("permissions.updated", "user", user.id, f"Updated form permissions for {user.username}")
            db.session.commit()
            flash("تم حفظ صلاحيات النماذج.", "success")
            return redirect(url_for("user_permissions", user_id=user.id))
        permissions = {
            p.form_id: p for p in FormPermission.query.filter_by(user_id=user.id).all()
        }
        return render_template("user_permissions.html", user=user, forms=forms, permissions=permissions)

    @app.route("/moderation")
    @login_required
    def moderation_dashboard():
        if current_user.role != "admin" and not current_user.can_moderate:
            abort(403)
        actions = ModerationAction.query.order_by(ModerationAction.created_at.desc(), ModerationAction.id.desc()).limit(500).all()
        staff_ids = {a.created_by for a in actions} | {a.updated_by for a in actions if a.updated_by}
        staff = {u.id: u for u in User.query.filter(User.id.in_(staff_ids)).all()} if staff_ids else {}
        return render_template("moderation.html", actions=actions, staff=staff)

    @app.route("/moderation/new", methods=["GET", "POST"])
    @login_required
    def new_moderation_action():
        if current_user.role != "admin" and not current_user.can_moderate:
            abort(403)
        if request.method == "POST":
            action_type = request.form.get("action_type", "").strip()
            player_uid = request.form.get("player_uid", "").strip()
            player_name = request.form.get("player_name", "").strip()
            server = request.form.get("server", "").strip()
            duration = request.form.get("duration", "").strip()
            reason = request.form.get("reason", "").strip()
            allowed_durations = {"10m", "1h", "6h", "24h", "7d", "30d", "permanent"}
            if action_type not in {"chat", "mail"} or not player_uid or not server or duration not in allowed_durations or not reason:
                flash("أكمل الحقول المطلوبة واختر نوع ومدة صالحين.", "error")
                return render_template("moderation_new.html", values=request.form)
            if len(player_uid) > 100 or len(server) > 100 or len(player_name) > 120 or len(reason) > 3000:
                flash("تجاوز أحد الحقول الحد المسموح للطول.", "error")
                return render_template("moderation_new.html", values=request.form)
            action = ModerationAction(
                action_type=action_type,
                player_uid=player_uid,
                player_name=player_name,
                server=server,
                duration=duration,
                reason=reason,
                status="pending",
                created_by=current_user.id,
            )
            db.session.add(action)
            db.session.flush()
            audit("moderation.recorded", "moderation_action", action.id, f"Recorded {action_type} moderation action for {player_uid}; not sent to game server")
            db.session.commit()
            flash("تم تسجيل إجراء الحظر في البوابة. يجب تنفيذه في أدوات اللعبة ثم تحديث حالته؛ هذا المشروع غير متصل حاليًا بواجهة خادم اللعبة.", "warning")
            return redirect(url_for("moderation_dashboard"))
        return render_template("moderation_new.html", values={})

    @app.post("/moderation/<int:action_id>/status")
    @login_required
    def update_moderation_action(action_id: int):
        if current_user.role != "admin" and not current_user.can_moderate:
            abort(403)
        action = db.get_or_404(ModerationAction, action_id)
        status = request.form.get("status", "pending")
        if status not in {"pending", "applied", "cancelled", "failed"}:
            abort(400)
        if current_user.role != "admin" and action.created_by != current_user.id:
            abort(403)
        action.status = status
        action.result_note = request.form.get("result_note", "").strip()[:3000]
        action.updated_by = current_user.id
        action.updated_at = utcnow()
        audit("moderation.status_updated", "moderation_action", action.id, f"Status changed to {status}")
        db.session.commit()
        flash("تم تحديث سجل الإجراء.", "success")
        return redirect(url_for("moderation_dashboard"))

    @app.route("/admin/audit")
    @login_required
    def audit_logs():
        require_admin()
        logs = AuditLog.query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(300).all()
        users_map = {u.id: u for u in User.query.all()}
        return render_template("audit.html", logs=logs, users_map=users_map)

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", code=403, title="غير مسموح", message="ليس لديك صلاحية للوصول إلى هذه الصفحة."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", code=404, title="الصفحة غير موجودة", message="الرابط غير صحيح أو أن الصفحة لم تعد متاحة."), 404

    return app


def checked(name: str) -> bool:
    return request.form.get(name) in {"on", "true", "1", "yes"}


def require_admin() -> None:
    if not current_user.is_authenticated or current_user.role != "admin":
        abort(403)


def permission_for(user_id: int, form_id: int) -> FormPermission | None:
    return FormPermission.query.filter_by(user_id=user_id, form_id=form_id).first()


def can_access(form_id: int, action: str) -> bool:
    if not current_user.is_authenticated:
        return False
    if current_user.role == "admin":
        return True
    p = permission_for(current_user.id, form_id)
    if not p:
        return False
    if p.can_manage:
        return action in {"read", "results", "edit", "manage"}
    if action == "read":
        return p.can_read or p.can_results or p.can_edit
    if action == "results":
        return p.can_results
    if action == "edit":
        return p.can_edit
    if action == "manage":
        return p.can_manage
    return False


def unique_slug(raw: str, exclude_form_id: int | None = None) -> str:
    base = re.sub(r"[^a-zA-Z0-9-]+", "-", raw.strip().lower()).strip("-")
    if not base:
        base = f"form-{secrets.token_hex(3)}"
    base = base[:80]
    candidate = base
    index = 2
    while True:
        query = Form.query.filter_by(slug=candidate)
        if exclude_form_id is not None:
            query = query.filter(Form.id != exclude_form_id)
        if query.first() is None:
            return candidate
        candidate = f"{base[:72]}-{index}"
        index += 1


def read_field_value(field: FormField, submitted_form) -> str:
    if field.field_type == "checkbox":
        return "نعم" if submitted_form.get(field.field_key) == "on" else "لا"
    return submitted_form.get(field.field_key, "").strip()


def build_result_columns(form: Form, submissions: list[Submission]) -> list[dict[str, str]]:
    columns: list[dict[str, str]] = []
    seen: set[str] = set()
    current_fields = FormField.query.filter_by(form_id=form.id).order_by(FormField.position, FormField.id).all()
    for field in current_fields:
        if field.field_key not in seen:
            columns.append({"key": field.field_key, "label": field.label})
            seen.add(field.field_key)
    # Keep deleted/renamed fields visible for old submissions using their snapshots.
    old_columns: dict[str, str] = {}
    for submission in submissions:
        try:
            data = json.loads(submission.data_json)
        except (json.JSONDecodeError, TypeError):
            data = []
        for item in data if isinstance(data, list) else []:
            if isinstance(item, dict):
                key = str(item.get("key", ""))
                label = str(item.get("label", ""))
                if key and key not in seen and key not in old_columns:
                    old_columns[key] = label or "حقل محذوف"
    columns.extend({"key": key, "label": label} for key, label in old_columns.items())
    return columns


def audit(action: str, entity_type: str = "", entity_id: Any = "", details: str = "") -> None:
    user_id = current_user.id if current_user.is_authenticated else None
    db.session.add(AuditLog(
        user_id=user_id,
        action=action[:100],
        entity_type=entity_type[:80],
        entity_id=str(entity_id)[:80],
        details=details[:5000],
    ))


app = create_app()

if __name__ == "__main__":
    # For local development only. Use Gunicorn on production hosts.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)
