"""Fixed clarifying questions that don't depend on a model (plan section 2.2, Journey B).

NOTE for Lane D: the hi/ta/mr/bn wording was written by an AI assistant and has not been checked by a
native speaker. Review it before the demo.
"""

import re

PV_CATEGORIES = {"pv_delay", "adverse_pv"}

# What a user says when they already told us the PV status: no need to ask.
_STATUS_GIVEN = re.compile(
    r"initiated|adverse|completed|report|clear|on hold|closed|"
    r"शुरू|प्रतिकूल|पूरा|रिपोर्ट|"
    r"தொடங்க|பாதக|முடிந்த|அறிக்கை|"
    r"सुरू|प्रतिकूल|पूर्ण|अहवाल|"
    r"শুরু|প্রতিকূল|সম্পূর্ণ|প্রতিবেদন",
    re.IGNORECASE,
)

PV_STATUS_QUESTION = {
    "en": "What does your status say: 'police verification initiated', or an 'adverse report'?",
    "hi": "आपका स्टेटस क्या कहता है: 'पुलिस सत्यापन शुरू हुआ' या 'प्रतिकूल रिपोर्ट'?",
    "ta": "உங்கள் நிலை என்ன கூறுகிறது: 'காவல்துறை சரிபார்ப்பு தொடங்கப்பட்டது' அல்லது 'பாதகமான அறிக்கை'?",
    "mr": "तुमचा स्टेटस काय म्हणतो: 'पोलीस पडताळणी सुरू झाली' की 'प्रतिकूल अहवाल'?",
    "bn": "আপনার স্ট্যাটাসে কী লেখা আছে: 'পুলিশ ভেরিফিকেশন শুরু হয়েছে' নাকি 'প্রতিকূল প্রতিবেদন'?",
}


def pv_status_question(*, category: str, stage: str, text: str, lang: str, clarify_count: int) -> str | None:
    """Ask once whether PV is merely under way or came back adverse, since the advice differs completely."""
    if clarify_count > 0 or _STATUS_GIVEN.search(text):
        return None
    if category in PV_CATEGORIES or stage == "police_verification":
        return PV_STATUS_QUESTION.get(lang, PV_STATUS_QUESTION["en"])
    return None
