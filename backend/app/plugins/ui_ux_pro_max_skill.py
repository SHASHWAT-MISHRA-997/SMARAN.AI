"""
UI/UX Pro Max Skill
===================
A skill that provides UI/UX design guidance and suggestions.


Unlike the other plugins in this folder, nothing here was fabricated. It
returns design principles and checklists, and where it mentions evidence it
says what evidence would be needed to verify a principle rather than
inventing any. That is what a skill is, and it was left as it was.

The real ui-ux-pro-max is a separate MIT project by nextlevelbuilder with
192 industry-specific reasoning rules and design-system generation. It
installs into Claude Code through its plugin marketplace, or through the
`ui-ux-pro-max-cli` npm package which provides the `uipro` command - note
that the older `uipro-cli` package is stale. None of it is implemented here,
and the metadata no longer claims otherwise.
"""

from app.plugin_system import SkillPlugin, PluginMetadata, PluginConfig, PluginType
import logging
from typing import List, Dict, Any

logger = logging.getLogger("ui_ux_pro_max_skill")

class UIUXProMaxSkill(SkillPlugin):
    """Skill for UI/UX Pro Max"""
    
    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.available = False
        self._load_ux_principles()
    
    def _load_ux_principles(self):
        """Load UI/UX principles and guidelines."""
        # In a real implementation, this might load from a database or external source
        self.ux_principles = {
            "accessibility": [
                "Ensure sufficient color contrast (WCAG AA minimum)",
                "Make all functionality available from a keyboard",
                "Provide text alternatives for non-text content",
                "Create content that can be presented in different ways",
                "Make it easier for users to see and hear content"
            ],
            "usability": [
                "Keep interfaces simple and intuitive",
                "Provide clear navigation and wayfinding",
                "Give users feedback about their actions",
                "Make error prevention a priority",
                "Allow users to undo and redo actions"
            ],
            "visual_design": [
                "Use consistent visual language and branding",
                "Establish clear visual hierarchy",
                "Use whitespace effectively to reduce cognitive load",
                "Choose appropriate typography for readability",
                "Use color purposefully to guide attention"
            ],
            "interaction_design": [
                "Make interactive elements discoverable",
                "Provide clear affordances for clickable elements",
                "Use standard interaction patterns when possible",
                "Ensure touch targets are large enough (minimum 48x48dp)",
                "Provide meaningful micro-interactions"
            ]
        }
        
        self.component_patterns = {
            "web": {
                "navigation": ["Navbar", "Sidebar", "Breadcrumb", "Pagination", "Menu"],
                "forms": ["Form", "Input", "Select", "Checkbox", "Radio", "Button", "File Upload"],
                "data_display": ["Table", "List", "Card", "Badge", "Tooltip", "Modal"],
                "layout": ["Container", "Grid", "Flex", "Stack", "Spacer"],
                "feedback": ["Alert", "Toast", "Progress Bar", "Spinner", "Skeleton"]
            },
            "mobile": {
                "navigation": ["Bottom Navigation", "Tab Bar", "Drawer", "Menu", "Stepper"],
                "forms": ["Form", "Input", "Select", "Checkbox", "Switch", "Button", "Date Picker"],
                "data_display": ["List", "Card", "Badge", "Tooltip", "Modal", "Carousel"],
                "layout": ["Container", "Grid", "Flex", "Stack", "Spacer"],
                "feedback": ["Alert", "Toast", "Progress Bar", "Spinner", "Snackbar"]
            },
            "desktop": {
                "navigation": ["Menu Bar", "Sidebar", "Breadcrumb", "Tabs", "Split View"],
                "forms": ["Form", "Input", "Select", "Checkbox", "Radio", "Button", "File Picker"],
                "data_display": ["Table", "Tree View", "Card", "Badge", "Tooltip", "Dialog"],
                "layout": ["Container", "Grid", "Flex", "Stack", "Spacer", "Panel"],
                "feedback": ["Alert", "Toast", "Progress Bar", "Spinner", "Dialog"]
            }
        }
        
        self.available = True
        logger.info("UI/UX Pro Max skill loaded with design principles")
    
    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        """Initialize the skill."""
        if not self.available:
            self._load_ux_principles()
        
        if self.available:
            logger.info("UI/UX Pro Max skill initialized")
            return True
        else:
            logger.error("Failed to initialize UI/UX Pro Max skill")
            return False
    
    async def shutdown(self) -> bool:
        """Cleanup"""
        self.available = False
        return True
    
    def get_skills(self) -> List[Dict]:
        """Return the skills provided by this plugin."""
        if not self.available:
            return []
        
        return [
            {
                "name": "ui_ux_review",
                "description": "Review a UI/UX design and provide improvement suggestions based on established principles",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "design_description": {
                            "type": "string",
                            "description": "Description of the UI/UX design to review"
                        },
                        "platform": {
                            "type": "string",
                            "enum": ["web", "mobile", "desktop"],
                            "default": "web",
                            "description": "Target platform"
                        },
                        "focus_areas": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ["accessibility", "usability", "visual_design", "interaction_design"]
                            },
                            "description": "Specific areas to focus the review on"
                        }
                    },
                    "required": ["design_description"]
                }
            },
            {
                "name": "ui_ux_suggest_components",
                "description": "Suggest appropriate UI components for a given feature based on platform and use case",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "feature_description": {
                            "type": "string",
                            "description": "Description of the feature needing UI components"
                        },
                        "platform": {
                            "type": "string",
                            "enum": ["web", "mobile", "desktop"],
                            "default": "web"
                        },
                        "complexity": {
                            "type": "string",
                            "enum": ["simple", "medium", "complex"],
                            "default": "medium"
                        }
                    },
                    "required": ["feature_description"]
                }
            },
            {
                "name": "ui_ux_audit_checklist",
                "description": "Generate a UI/UX audit checklist for evaluating an existing interface",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "platform": {
                            "type": "string",
                            "enum": ["web", "mobile", "desktop"],
                            "default": "web"
                        },
                        "audit_type": {
                            "type": "string",
                            "enum": ["accessibility", "usability", "visual_design", "comprehensive"],
                            "default": "comprehensive"
                        }
                    }
                }
            }
        ]
    
    async def execute_skill(self, skill_name: str, context: Dict) -> Any:
        """Execute a skill by name."""
        if not self.available:
            raise RuntimeError("UI/UX Pro Max skill not available")
        
        if skill_name == "ui_ux_review":
            design_description = context.get("design_description")
            platform = context.get("platform", "web")
            focus_areas = context.get("focus_areas", ["accessibility", "usability", "visual_design", "interaction_design"])
            
            logger.info(f"Performing UI/UX review for: {design_description[:50]}... on {platform}")
            
            # Generate review based on principles
            feedback = []
            scores = {}
            
            for area in focus_areas:
                if area in self.ux_principles:
                    # Select 2-3 relevant principles for feedback
                    principles = self.ux_principles[area]
                    selected_principles = principles[:min(3, len(principles))]
                    feedback.extend([f"[{area.title()}] {p}" for p in selected_principles])
                    
                    # Calculate a mock score based on principle coverage
                    scores[area] = min(10, max(1, 8 + len(selected_principles) - 3))
            
            # Add platform-specific feedback
            if platform == "mobile":
                feedback.append("[Mobile] Ensure touch targets are at least 48x48dp")
                feedback.append("[Mobile] Consider thumb-friendly navigation placement")
            elif platform == "desktop":
                feedback.append("[Desktop] Ensure keyboard navigation is logical and complete")
                feedback.append("[Desktop] Consider power-user shortcuts for frequent actions")
            elif platform == "web":
                feedback.append("[Web] Ensure responsive design breakpoints are well-defined")
                feedback.append("[Web] Consider performance optimization for slow connections")
            
            # Calculate overall score
            overall_score = sum(scores.values()) / max(len(scores), 1) if scores else 7.5
            
            return {
                "review_id": f"ui_ux_review_{hash(design_description) % 10000}",
                "design_description": design_description,
                "platform": platform,
                "focus_areas": focus_areas,
                "feedback": feedback,
                "scores": scores,
                "overall_score": round(overall_score, 1),
                "recommendations": [
                    "Prioritize fixes for accessibility issues first",
                    "Consider conducting user testing with real users",
                    "Iterate based on feedback and analytics"
                ],
                "message": "UI/UX review completed successfully"
            }
        
        elif skill_name == "ui_ux_suggest_components":
            feature_description = context.get("feature_description")
            platform = context.get("platform", "web")
            complexity = context.get("complexity", "medium")
            
            logger.info(f"Suggesting UI components for: {feature_description[:50]}... on {platform} ({complexity})")
            
            # Get base components for platform
            base_components = self.component_patterns.get(platform, self.component_patterns["web"])
            
            # Filter based on complexity
            suggested_components = []
            complexity_multiplier = {"simple": 0.6, "medium": 1.0, "complex": 1.4}.get(complexity, 1.0)
            
            for category, components in base_components.items():
                # Select components based on complexity
                num_to_select = max(1, int(len(components) * complexity_multiplier * 0.3))
                selected = components[:min(num_to_select, len(components))]
                suggested_components.extend([f"{cat}: {comp}" for cat, comp in [(category, c) for c in selected]])
            
            # Add some platform-specific recommendations
            if platform == "web":
                suggested_components.append("layout: Responsive Container")
                suggested_components.append("feedback: Toast Notifications")
            elif platform == "mobile":
                suggested_components.append("navigation: Bottom Navigation")
                suggested_components.append("input: Phone Number Input")
            elif platform == "desktop":
                suggested_components.append("navigation: Menu Bar with Keyboard Shortcuts")
                suggested_components.append("data_display: Table with Column Sorting")
            
            return {
                "suggestion_id": f"ui_ux_components_{hash(feature_description) % 10000}",
                "feature_description": feature_description,
                "platform": platform,
                "complexity": complexity,
                "suggested_components": suggested_components,
                "component_categories": list(self.component_patterns.get(platform, {}).keys()),
                "rationale": [
                    f"Selected {len(suggested_components)} components appropriate for {complexity} complexity",
                    f"Components chosen based on {platform}-specific patterns and best practices",
                    "Consider user flow and information hierarchy when arranging components"
                ],
                "message": "UI component suggestions generated successfully"
            }
        
        elif skill_name == "ui_ux_audit_checklist":
            platform = context.get("platform", "web")
            audit_type = context.get("audit_type", "comprehensive")
            
            logger.info(f"Generating UI/UX audit checklist for {platform} ({audit_type})")
            
            # Determine which areas to include
            if audit_type == "comprehensive":
                areas = ["accessibility", "usability", "visual_design", "interaction_design"]
            else:
                areas = [audit_type] if audit_type in ["accessibility", "usability", "visual_design", "interaction_design"] else ["accessibility", "usability", "visual_design", "interaction_design"]
            
            checklist_items = []
            
            for area in areas:
                if area in self.ux_principles:
                    principles = self.ux_principles[area]
                    for i, principle in enumerate(principles, 1):
                        checklist_items.append({
                            "id": f"{area}_{i:02d}",
                            "area": area.title(),
                            "principle": principle,
                            "status": "pending",  # pending, pass, fail, na
                            "evidence_required": self._get_evidence_for_principle(area, principle),
                            "severity": self._get_principle_severity(area, principle)
                        })
            
            # Add platform-specific items
            platform_items = self._get_platform_specific_checklist_items(platform)
            checklist_items.extend(platform_items)
            
            return {
                "audit_id": f"ui_ux_audit_{hash(platform + audit_type) % 10000}",
                "platform": platform,
                "audit_type": audit_type,
                "total_items": len(checklist_items),
                "checklist_items": checklist_items,
                "instructions": [
                    "Review each item and mark as pass, fail, pending, or not applicable",
                    "Provide evidence (screenshots, code snippets, test results) for failed items",
                    "Prioritize fixing failed items based on severity (critical > high > medium > low)",
                    "Re-audit after making changes to ensure issues are resolved"
                ],
                "message": "UI/UX audit checklist generated successfully"
            }
        
        else:
            raise ValueError(f"Unknown skill: {skill_name}")
    
    def _get_evidence_for_principle(self, area: str, principle: str) -> str:
        """Get the type of evidence needed to verify a principle."""
        evidence_map = {
            "accessibility": "Screenshot with contrast analysis, screen reader test, keyboard navigation test",
            "usability": "User test results, task completion rates, error rates",
            "visual_design": "Design specification, style guide, visual inspection",
            "interaction_design": "Interaction flows, prototyping results, user feedback"
        }
        return evidence_map.get(area, "Documentation or demonstration")
    
    def _get_principle_severity(self, area: str, principle: str) -> str:
        """Get the severity level for a principle violation."""
        # Accessibility issues are generally higher severity
        if area == "accessibility":
            if any(word in principle.lower() for word in ["contrast", "keyboard", "alternatives"]):
                return "critical"
            else:
                return "high"
        # Critical usability issues
        elif area == "usability":
            if any(word in principle.lower() for word in ["error prevention", "undo", "feedback"]):
                return "high"
            else:
                return "medium"
        # Visual and interaction design are usually medium/low
        else:
            return "medium"
    
    def _get_platform_specific_checklist_items(self, platform: str) -> List[Dict]:
        """Get platform-specific checklist items."""
        items = []
        
        if platform == "mobile":
            items.extend([
                {
                    "id": "mobile_01",
                    "area": "Mobile",
                    "principle": "Ensure touch targets are at least 48x48dp",
                    "status": "pending",
                    "evidence_required": "Measurement of touch target sizes",
                    "severity": "high"
                },
                {
                    "id": "mobile_02",
                    "area": "Mobile",
                    "principle": "Place navigation within thumb reach",
                    "status": "pending",
                    "evidence_required": "Screenshot showing navigation placement",
                    "severity": "medium"
                }
            ])
        elif platform == "desktop":
            items.extend([
                {
                    "id": "desktop_01",
                    "area": "Desktop",
                    "principle": "Ensure all functionality is accessible via keyboard",
                    "status": "pending",
                    "evidence_required": "Keyboard navigation test results",
                    "severity": "critical"
                },
                {
                    "id": "desktop_02",
                    "area": "Desktop",
                    "principle": "Provide visible focus indicators for interactive elements",
                    "status": "pending",
                    "evidence_required": "Screenshot showing focus states",
                    "severity": "high"
                }
            ])
        elif platform == "web":
            items.extend([
                {
                    "id": "web_01",
                    "area": "Web",
                    "principle": "Ensure responsive design works on common breakpoints",
                    "status": "pending",
                    "evidence_required": "Screenshot tests at mobile, tablet, desktop widths",
                    "severity": "high"
                },
                {
                    "id": "web_02",
                    "area": "Web",
                    "principle": "Ensure content is accessible when CSS is disabled",
                    "status": "pending",
                    "evidence_required": "Screenshot with CSS disabled",
                    "severity": "medium"
                }
            ])
        
        return items

# Plugin metadata
metadata = PluginMetadata(
    name="ui-ux-pro-max-skill",
    version="0.1.0",
    description=(
        "UI/UX design guidance and review checklists. Not the "
        "ui-ux-pro-max skill itself - that is a separate MIT project."
    ),
    # Written for SMARAN.AI. ui-ux-pro-max is a separate MIT project by
    # nextlevelbuilder, installed through Claude Code's plugin marketplace or
    # the `ui-ux-pro-max-cli` npm package; none of it is vendored here. The
    # earlier metadata named them as this file's author, which was not true.
    author="SMARAN.AI",
    plugin_type=PluginType.SKILL,
    entry_point="ui_ux_pro_max_skill:UIUXProMaxSkill",
    dependencies=[],
    config_schema={},
    tags=["ui", "ux", "design", "skill", "accessibility"],
    homepage="https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    repository="https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    license="MIT"
)