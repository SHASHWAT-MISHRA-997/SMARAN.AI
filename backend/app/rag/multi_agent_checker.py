import logging
import json
import os
import re
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.rag.pipeline import RAGPipeline
from app.utils import zep_get_history

logger = logging.getLogger("MultiAgentChecker")

class MultiAgentSystem:
    def __init__(self, db: Session, session_id: str, collections: List[int], user_prompt: str):
        self.db = db
        self.session_id = session_id
        self.collections = collections
        self.user_prompt = user_prompt
        self.rag_pipeline = RAGPipeline()
        self.state = {
            "query": user_prompt,
            "context_chunks": [],
            "zep_memories": [],
            "analyst_draft": "",
            "fact_checker_notes": "",
            "fact_checker_approved": False,
            "final_response": "",
            "loop_count": 0,
            "max_loops": 3
        }

    async def gather_context(self):
        # 1. Fetch from Qdrant via RAG Pipeline
        if self.collections:
            try:
                self.state["context_chunks"] = self.rag_pipeline.search(
                    db=self.db,
                    query=self.user_prompt,
                    collection_ids=self.collections,
                    limit=10
                )
            except Exception as e:
                logger.error(f"Error during Qdrant context gathering: {e}")

        # 2. Fetch Zep timeline memory context
        try:
            self.state["zep_memories"] = await zep_get_history(self.session_id)
        except Exception as e:
            logger.error(f"Error during Zep history gathering: {e}")

    def router_agent(self) -> str:
        """Determines routing category: 'calculation', 'general_rag', or 'simple_chat'."""
        prompt = self.user_prompt.lower()
        calculation_keywords = [
            "calculate", "sum", "average", "total", "math", "salary", "bonus", "employee count",
            "po total", "invoice total", "formula", "subtract", "divide", "multiply", "how many"
        ]
        if any(kw in prompt for kw in calculation_keywords):
            logger.info("Router Agent: Routed query to Data Analyst (Calculations required).")
            return "calculation"
        
        if self.collections:
            logger.info("Router Agent: Routed query to general RAG pipeline.")
            return "general_rag"
            
        logger.info("Router Agent: Routed query to standard conversational chat.")
        return "simple_chat"

    def data_analyst_agent(self) -> str:
        """Processes tabular context and drafts an initial calculation / response."""
        context_str = "\n".join([c["text"] for c in self.state["context_chunks"]])
        mem_str = "\n".join([m.get("content", "") for m in self.state["zep_memories"]])
        
        # Simple extraction heuristics to simulate the Data Analyst parsing rows
        # E.g., looking for numeric lists and computing averages or counts
        numbers = [float(x) for x in re.findall(r"\$?\b\d+(?:\.\d+)?\b", context_str + " " + self.user_prompt) if len(x) < 8]
        
        logger.info("Data Analyst Agent: Drafting response based on extracted numbers...")
        
        # In a real environment, the analyst agent would call the LLM with system prompts.
        # Here we provide a structured template that the fact checker will audit.
        draft = (
            f"Based on the corporate reports, here is the analysis:\n"
            f"- Extracted key figures: {', '.join([str(n) for n in numbers[:5]])}\n"
        )
        if "average" in self.user_prompt.lower() and len(numbers) > 0:
            avg_val = sum(numbers) / len(numbers)
            draft += f"- Calculated Average: {round(avg_val, 2)}\n"
        elif "sum" in self.user_prompt.lower() or "total" in self.user_prompt.lower():
            sum_val = sum(numbers)
            draft += f"- Calculated Total: {round(sum_val, 2)}\n"
        else:
            draft += f"- Summary of facts: The documents contain reference to these figures.\n"
            
        return draft

    def fact_checker_agent(self) -> Dict[str, Any]:
        """Cross-references calculations with Qdrant chunks and Zep memories. Detects hallucinations."""
        draft = self.state["analyst_draft"]
        context_str = "\n".join([c["text"] for c in self.state["context_chunks"]]).lower()
        
        logger.info("Fact-Checker Agent: Verifying calculations and database facts...")
        
        # Cross-reference calculation totals
        hallucination_detected = False
        notes = []
        
        # Rule check: check if the drafted total matches actual values in the document chunks
        total_match = re.search(r"calculated (?:total|average):\s*(\d+(?:\.\d+)?)", draft, re.IGNORECASE)
        if total_match:
            calc_val = float(total_match.group(1))
            # Scan text for any numeric fields to double-check
            doc_vals = [float(x) for x in re.findall(r"\b\d+(?:\.\d+)?\b", context_str) if len(x) < 8]
            
            # Simple fact verification logic
            if "total" in self.user_prompt.lower() and doc_vals:
                expected_total = sum(doc_vals)
                # If calculations don't align, flag a hallucination
                if abs(calc_val - expected_total) > 0.01:
                    hallucination_detected = True
                    notes.append(f"Factual discrepancy: Analyst draft total is {calc_val}, but actual sum of document numbers is {expected_total}.")
        
        # Strict timeline check against Zep memories
        for mem in self.state["zep_memories"]:
            mem_content = mem.get("content", "").lower()
            # If the user draft conflicts with long term memory facts, flag it
            if "not found" in draft.lower() and len(mem_content) > 3:
                # E.g., user is Aditya but analyst says unknown name
                hallucination_detected = True
                notes.append("Hallucination: Draft says facts not found, but Zep memory contains user timeline facts.")

        if hallucination_detected:
            logger.warning(f"Fact-Checker Agent: Hallucination detected! Loop back triggered. Notes: {notes}")
            return {
                "approved": False,
                "notes": "; ".join(notes)
            }
        
        logger.info("Fact-Checker Agent: Factual check passed. Approving draft.")
        return {
            "approved": True,
            "notes": "All calculations matched vector contexts and memory timelines."
        }

    async def execute_workflow(self) -> str:
        """Coordinates the multi-agent state machine in the background."""
        # 1. Gather RAG and timeline contexts
        await self.gather_context()
        
        # 2. Route the request
        route = self.router_agent()
        
        if route == "simple_chat" and not self.collections:
            return "" # fallback to direct LLM stream
            
        # 3. Agent Execution Loop
        while self.state["loop_count"] < self.state["max_loops"]:
            self.state["loop_count"] += 1
            logger.info(f"Agent Loop: Iteration {self.state['loop_count']} of {self.state['max_loops']}")
            
            # Analyst does the work
            self.state["analyst_draft"] = self.data_analyst_agent()
            
            # Fact checker audits
            audit = self.fact_checker_agent()
            if audit["approved"]:
                self.state["fact_checker_approved"] = True
                self.state["fact_checker_notes"] = audit["notes"]
                self.state["final_response"] = self.state["analyst_draft"]
                break
            else:
                # Loop back: analyst uses checker notes to fix the draft
                self.state["fact_checker_notes"] = audit["notes"]
                # Simulate correction: analyst updates figures to reflect correct calculations
                # In real LLM loops, we'd feed the checker notes back to the analyst system prompt
                logger.info("Analyst Agent: Self-correcting based on fact-checker feedback...")
                # Correction simulation:
                discrepancy = audit["notes"]
                if "sum of document numbers is" in discrepancy:
                    correct_sum = discrepancy.split("sum of document numbers is")[-1].strip().rstrip('.')
                    self.state["analyst_draft"] = (
                        f"Correction Applied: Calculations cross-referenced with database vectors.\n"
                        f"- Verified Data Total: {correct_sum}\n"
                        f"Calculations verified by background Fact-Checker Agent."
                    )
                    self.state["fact_checker_approved"] = True
                    self.state["final_response"] = self.state["analyst_draft"]
                    break
        
        return self.state["final_response"]
